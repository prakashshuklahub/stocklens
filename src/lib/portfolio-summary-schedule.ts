/**
 * Background portfolio summary rebuild — dedupes concurrent regenerates per user.
 */

import {
  loadOrRefreshPortfolioSummary,
  regenerateWithLock,
} from '@/lib/portfolio-summary-generate'
import { isCronWorkAllowed, logCronWindowSkip, getCronWindowStatus } from '@/lib/cron/window'
import {
  loadPortfolioSummaryRow,
  needsPortfolioSummaryRegenerate,
} from '@/lib/portfolio-summary-cache'
import { hashPortfolioHoldings } from '@/lib/portfolio-summary-hash'
import type { createServerClient } from '@/lib/supabase'
import type { PortfolioDailySummaryPayload, PortfolioHolding } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

const inflight = new Map<string, Promise<PortfolioDailySummaryPayload | null>>()

export async function regeneratePortfolioSummaryIfNeeded(
  supabase: Supabase,
  userId: string,
  reason: string,
  force = false,
): Promise<PortfolioDailySummaryPayload | null> {
  const { data: holdings } = await supabase
    .from('portfolio_holdings')
    .select('ticker, quantity, avg_cost_basis')
    .eq('user_id', userId)

  if (!holdings?.length) return null

  const hash = hashPortfolioHoldings(holdings as PortfolioHolding[])
  const row = await loadPortfolioSummaryRow(supabase, userId)

  if (!force && !isCronWorkAllowed()) {
    const status = getCronWindowStatus()
    if (!status.allowed) logCronWindowSkip('portfolio-summary', status)
    return row?.payload ?? null
  }

  if (!needsPortfolioSummaryRegenerate(row, hash)) return row?.payload ?? null

  const existing = inflight.get(userId)
  if (existing) return existing

  const job = regenerateWithLock(supabase, userId)
    .then((payload) => {
      console.info(`[portfolio-summary] background refresh complete (${reason}) user=${userId}`)
      return payload
    })
    .catch((err) => {
      console.warn('[portfolio-summary] background refresh failed:', err)
      return null
    })
    .finally(() => {
      inflight.delete(userId)
    })

  inflight.set(userId, job)
  return job
}

export { loadOrRefreshPortfolioSummary }
