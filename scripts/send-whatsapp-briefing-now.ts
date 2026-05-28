/**
 * One-off: send WhatsApp daily briefing to one user (sandbox test).
 * Run: set -a && source .env.local && set +a && npx tsx scripts/send-whatsapp-briefing-now.ts --user=you@example.com
 */

import { formatBriefingForWhatsApp } from '@/lib/whatsapp/format-briefing'
import { loadPortfolioSummaryRow } from '@/lib/portfolio-summary-cache'
import { regenerateWithLock } from '@/lib/portfolio-summary-generate'
import { isTwilioConfigured, sendWhatsAppMessageParts } from '@/lib/twilio/whatsapp'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

function createScriptSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as unknown as typeof WebSocket },
  })
}

function parseArg(name: string): string | null {
  const prefix = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(prefix))
  return hit ? hit.slice(prefix.length) : null
}

async function main() {
  const email = parseArg('user')
  if (!email) {
    console.error('Usage: npx tsx scripts/send-whatsapp-briefing-now.ts --user=email@example.com')
    process.exit(1)
  }

  if (!isTwilioConfigured()) {
    console.error('Twilio env vars missing (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM)')
    process.exit(1)
  }

  const supabase = createScriptSupabase()

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, email, whatsapp_number, preferences')
    .eq('email', email)
    .maybeSingle()

  if (userError || !user) {
    console.error(userError?.message ?? `User not found: ${email}`)
    process.exit(1)
  }

  if (!user.whatsapp_number) {
    console.error('User has no whatsapp_number — save it in /settings first')
    process.exit(1)
  }

  const prefs = (user.preferences ?? {}) as Record<string, unknown>
  if (prefs.whatsapp_daily_briefing !== true) {
    console.warn('Warning: whatsapp_daily_briefing is not enabled — sending anyway for test')
  }

  const { data: holdings } = await supabase
    .from('portfolio_holdings')
    .select('ticker, quantity, avg_cost_basis')
    .eq('user_id', user.id)

  if (!holdings?.length) {
    console.error('User has no portfolio holdings')
    process.exit(1)
  }

  let row = await loadPortfolioSummaryRow(supabase, user.id)
  if (!row?.payload?.holdings.length) {
    console.log('No cached briefing — regenerating…')
    await regenerateWithLock(supabase, user.id)
    row = await loadPortfolioSummaryRow(supabase, user.id)
  }

  if (!row?.payload?.holdings.length) {
    console.error('Could not load portfolio briefing')
    process.exit(1)
  }

  const body = formatBriefingForWhatsApp({ payload: row.payload })

  console.log('\n--- Message preview ---\n')
  console.log(body)
  console.log('\n--- Sending ---\n')

  const results = await sendWhatsAppMessageParts(user.whatsapp_number, body)
  const failed = results.find((r) => !r.ok)
  if (failed) {
    console.error(`Send failed: ${failed.message} (code=${failed.code})`)
    process.exit(1)
  }

  await supabase.from('notifications_log').insert({
    user_id: user.id,
    type: 'daily_briefing',
    channel: 'whatsapp',
    message: body.slice(0, 500),
    delivered: true,
  })

  const sids = results.filter((r) => r.ok).map((r) => r.sid)
  console.log(`Sent ${results.length} part(s) to ${user.whatsapp_number} sid=${sids.join(', ')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
