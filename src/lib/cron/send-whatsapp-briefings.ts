import {
  isUSMarketWeekday,
  isWhatsAppBriefingSendWindow,
  startOfUSEasternDayIso,
} from '@/lib/market-hours'
import {
  loadPortfolioSummaryRow,
  needsPortfolioSummaryRegenerate,
} from '@/lib/portfolio-summary-cache'
import { hashPortfolioHoldings } from '@/lib/portfolio-summary-hash'
import { regenerateWithLock } from '@/lib/portfolio-summary-generate'
import { formatBriefingForWhatsApp } from '@/lib/whatsapp/format-briefing'
import {
  isTwilioConfigured,
  sendWhatsAppMessageParts,
  type SendWhatsAppResult,
} from '@/lib/twilio/whatsapp'
import type { createServerClient } from '@/lib/supabase'
import type { PortfolioDailySummaryPayload, PortfolioHolding } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

const USERS_PER_RUN = 20
const TWILIO_DELAY_MS = 1000

export type SendWhatsAppBriefingsResult = {
  skipped?: boolean
  reason?: string
  us_market_weekday: boolean
  send_window_open: boolean
  users_eligible: number
  users_attempted: number
  sent: number
  failed: number
  skipped_already_sent: number
  skipped_no_summary: number
  opted_out: number
  errors: string[]
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type EligibleUser = {
  id: string
  whatsapp_number: string
  preferences: Record<string, unknown>
}

async function loadEligibleUsers(supabase: Supabase): Promise<EligibleUser[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, whatsapp_number, preferences')
    .not('whatsapp_number', 'is', null)
    .contains('preferences', { whatsapp_daily_briefing: true })

  if (error) {
    console.warn('[whatsapp-briefing] users query failed:', error.message)
    return []
  }

  const users = (data ?? []).filter(
    (u): u is EligibleUser =>
      Boolean(u.whatsapp_number) &&
      (u.preferences as Record<string, unknown> | null)?.whatsapp_daily_briefing === true,
  )

  if (!users.length) return []

  const eligible: EligibleUser[] = []
  const tradingDayStart = startOfUSEasternDayIso()

  for (const user of users) {
    const { count: holdingCount } = await supabase
      .from('portfolio_holdings')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)

    if (!holdingCount) continue

    const { data: sentToday } = await supabase
      .from('notifications_log')
      .select('id')
      .eq('user_id', user.id)
      .eq('type', 'daily_briefing')
      .eq('channel', 'whatsapp')
      .eq('delivered', true)
      .gte('sent_at', tradingDayStart)
      .limit(1)
      .maybeSingle()

    if (sentToday) continue

    eligible.push(user)
  }

  return eligible
}

async function loadPayloadForUser(
  supabase: Supabase,
  userId: string,
): Promise<PortfolioDailySummaryPayload | null> {
  const { data: holdings } = await supabase
    .from('portfolio_holdings')
    .select('ticker, quantity, avg_cost_basis')
    .eq('user_id', userId)

  if (!holdings?.length) return null

  const hash = hashPortfolioHoldings(holdings as PortfolioHolding[])
  let row = await loadPortfolioSummaryRow(supabase, userId)

  if (!row || needsPortfolioSummaryRegenerate(row, hash)) {
    const regenerated = await regenerateWithLock(supabase, userId)
    if (regenerated) return regenerated
    row = await loadPortfolioSummaryRow(supabase, userId)
  }

  return row?.payload ?? null
}

async function logNotification(
  supabase: Supabase,
  userId: string,
  message: string,
  delivered: boolean,
): Promise<void> {
  const { error } = await supabase.from('notifications_log').insert({
    user_id: userId,
    type: 'daily_briefing',
    channel: 'whatsapp',
    message: message.slice(0, 500),
    delivered,
  })

  if (error) console.warn('[whatsapp-briefing] notifications_log insert failed:', error.message)
}

async function optOutUser(supabase: Supabase, user: EligibleUser): Promise<void> {
  const prefs = { ...(user.preferences ?? {}), whatsapp_daily_briefing: false }
  const { error } = await supabase
    .from('users')
    .update({ preferences: prefs })
    .eq('id', user.id)

  if (error) console.warn('[whatsapp-briefing] opt-out update failed:', error.message)
}

async function sendToUser(
  supabase: Supabase,
  user: EligibleUser,
): Promise<'sent' | 'failed' | 'no_summary' | 'opted_out'> {
  const payload = await loadPayloadForUser(supabase, user.id)
  if (!payload?.holdings.length) return 'no_summary'

  const body = formatBriefingForWhatsApp({ payload })

  const results = await sendWhatsAppMessageParts(user.whatsapp_number, body, TWILIO_DELAY_MS)

  if (results.some((r) => !r.ok)) {
    const failed = results.find((r) => !r.ok)!
    await logNotification(supabase, user.id, body, false)
    if (failed.permanent) {
      await optOutUser(supabase, user)
      console.warn(
        `[whatsapp-briefing] opted out user=${user.id} code=${failed.code} msg=${failed.message}`,
      )
      return 'opted_out'
    }
    console.warn(`[whatsapp-briefing] send failed user=${user.id} msg=${failed.message}`)
    return 'failed'
  }

  await logNotification(supabase, user.id, body, true)
  if (results.length > 1) {
    console.info(`[whatsapp-briefing] sent ${results.length} parts user=${user.id}`)
  }
  return 'sent'
}

export async function sendWhatsAppBriefingsInDb(
  supabase: Supabase,
): Promise<SendWhatsAppBriefingsResult> {
  const sendWindowOpen = isWhatsAppBriefingSendWindow()
  const result: SendWhatsAppBriefingsResult = {
    us_market_weekday: isUSMarketWeekday(),
    send_window_open: sendWindowOpen,
    users_eligible: 0,
    users_attempted: 0,
    sent: 0,
    failed: 0,
    skipped_already_sent: 0,
    skipped_no_summary: 0,
    opted_out: 0,
    errors: [],
  }

  if (!isUSMarketWeekday()) {
    return { ...result, skipped: true, reason: 'weekend' }
  }

  if (!sendWindowOpen) {
    return { ...result, skipped: true, reason: 'outside_send_window' }
  }

  if (!isTwilioConfigured()) {
    return { ...result, skipped: true, reason: 'twilio_not_configured' }
  }

  const allEligible = await loadEligibleUsers(supabase)
  result.users_eligible = allEligible.length

  const batch = allEligible.slice(0, USERS_PER_RUN)

  for (let i = 0; i < batch.length; i++) {
    const user = batch[i]!
    result.users_attempted++

    try {
      const outcome = await sendToUser(supabase, user)
      if (outcome === 'sent') result.sent++
      else if (outcome === 'failed') result.failed++
      else if (outcome === 'no_summary') result.skipped_no_summary++
      else if (outcome === 'opted_out') result.opted_out++
    } catch (err) {
      result.failed++
      result.errors.push(`${user.id}: ${err instanceof Error ? err.message : String(err)}`)
    }

    if (i < batch.length - 1) await sleep(TWILIO_DELAY_MS)
  }

  return result
}
