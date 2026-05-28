import { NARRATIVE_TTL_HOURS } from '@/lib/narrative-cache'
import type { createServerClient } from '@/lib/supabase'
import type { PortfolioDailySummaryPayload } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

export type PortfolioSummaryRow = {
  user_id: string
  payload: PortfolioDailySummaryPayload
  holdings_hash: string
  generated_at: string
  narrative_source: 'llm' | 'mechanical'
  model: string | null
  is_regenerating: boolean
  regenerate_started_at: string | null
}

const REGENERATE_LOCK_MS = 10 * 60 * 1000

const PLACEHOLDER_PAYLOAD: PortfolioDailySummaryPayload = {
  version: 1,
  generated_at: new Date(0).toISOString(),
  holdings_hash: '',
  market_session: 'closed',
  portfolio_headline: '',
  portfolio_sentiment: 'neutral',
  holdings: [],
  degraded_tickers: [],
  inputs_as_of: {
    prices_at: null,
    fundamentals_age_min: null,
    fundamentals_age_max: null,
    research_age_min: null,
    research_age_max: null,
  },
  narrative_source: 'mechanical',
}

export function summaryTtlCutoff(): string {
  return new Date(Date.now() - NARRATIVE_TTL_HOURS * 3600 * 1000).toISOString()
}

/** Trigger A: holdings changed. Trigger B: TTL expired. */
export function needsPortfolioSummaryRegenerate(
  row: Pick<PortfolioSummaryRow, 'holdings_hash' | 'generated_at'> | null,
  currentHash: string,
): boolean {
  if (!row) return true
  if (row.holdings_hash !== currentHash) return true
  if (row.generated_at < summaryTtlCutoff()) return true
  return false
}

export function isSummaryStale(row: PortfolioSummaryRow | null, currentHash: string): boolean {
  return needsPortfolioSummaryRegenerate(row, currentHash)
}

export async function loadPortfolioSummaryRow(
  supabase: Supabase,
  userId: string,
): Promise<PortfolioSummaryRow | null> {
  const { data, error } = await supabase
    .from('portfolio_daily_summaries')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    console.warn('[portfolio-summary] SELECT failed:', error.message)
    return null
  }
  if (!data) return null

  return data as PortfolioSummaryRow
}

export async function savePortfolioSummary(
  supabase: Supabase,
  userId: string,
  payload: PortfolioDailySummaryPayload,
  holdingsHash: string,
  narrativeSource: 'llm' | 'mechanical',
  model: string | null,
): Promise<void> {
  const { error } = await supabase.from('portfolio_daily_summaries').upsert(
    {
      user_id: userId,
      payload,
      holdings_hash: holdingsHash,
      generated_at: payload.generated_at,
      narrative_source: narrativeSource,
      model,
      is_regenerating: false,
      regenerate_started_at: null,
    },
    { onConflict: 'user_id' },
  )

  if (error) console.warn('[portfolio-summary] upsert failed:', error.message)
}

export async function tryAcquireSummaryLock(supabase: Supabase, userId: string): Promise<boolean> {
  const now = new Date().toISOString()
  const staleLockBefore = new Date(Date.now() - REGENERATE_LOCK_MS).toISOString()

  const { data: updated } = await supabase
    .from('portfolio_daily_summaries')
    .update({ is_regenerating: true, regenerate_started_at: now })
    .eq('user_id', userId)
    .or(`is_regenerating.eq.false,regenerate_started_at.lt.${staleLockBefore}`)
    .select('user_id')
    .maybeSingle()

  if (updated) return true

  const { data: existing } = await supabase
    .from('portfolio_daily_summaries')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (existing) return false

  const { error } = await supabase.from('portfolio_daily_summaries').insert({
    user_id: userId,
    payload: { ...PLACEHOLDER_PAYLOAD, generated_at: now },
    holdings_hash: '',
    generated_at: now,
    narrative_source: 'mechanical',
    is_regenerating: true,
    regenerate_started_at: now,
  })

  return !error
}

export async function releaseSummaryLock(supabase: Supabase, userId: string): Promise<void> {
  await supabase
    .from('portfolio_daily_summaries')
    .update({ is_regenerating: false, regenerate_started_at: null })
    .eq('user_id', userId)
}

export async function listPortfolioUserIds(supabase: Supabase): Promise<string[]> {
  const { data, error } = await supabase.from('portfolio_holdings').select('user_id')
  if (error) {
    console.warn('[portfolio-summary] list users failed:', error.message)
    return []
  }
  return [...new Set((data ?? []).map((r) => String(r.user_id)))]
}
