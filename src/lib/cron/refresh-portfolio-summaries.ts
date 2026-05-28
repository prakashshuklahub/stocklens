import {
  listPortfolioUserIds,
  loadPortfolioSummaryRow,
  needsPortfolioSummaryRegenerate,
} from '@/lib/portfolio-summary-cache'
import { hashPortfolioHoldings } from '@/lib/portfolio-summary-hash'
import { regenerateWithLock } from '@/lib/portfolio-summary-generate'
import { mapSequential, LLM_CALL_DELAY_MS } from '@/lib/narrative-cache'
import type { createServerClient } from '@/lib/supabase'
import type { PortfolioHolding } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

const USERS_PER_RUN = 10

export type RefreshPortfolioSummariesResult = {
  users_total: number
  users_skipped_fresh: number
  users_skipped_inflight: number
  users_attempted: number
  summaries_written: number
  mechanical_fallbacks: number
  token_budget_fallbacks: number
  errors: string[]
}

export async function refreshPortfolioSummariesInDb(
  supabase: Supabase,
): Promise<RefreshPortfolioSummariesResult> {
  const result: RefreshPortfolioSummariesResult = {
    users_total: 0,
    users_skipped_fresh: 0,
    users_skipped_inflight: 0,
    users_attempted: 0,
    summaries_written: 0,
    mechanical_fallbacks: 0,
    token_budget_fallbacks: 0,
    errors: [],
  }

  const userIds = await listPortfolioUserIds(supabase)
  result.users_total = userIds.length
  if (!userIds.length) return result

  const queue: string[] = []

  for (const userId of userIds) {
    const { data: holdings } = await supabase
      .from('portfolio_holdings')
      .select('ticker, quantity, avg_cost_basis')
      .eq('user_id', userId)

    if (!holdings?.length) continue

    const hash = hashPortfolioHoldings(holdings as PortfolioHolding[])
    const row = await loadPortfolioSummaryRow(supabase, userId)

    if (row?.is_regenerating) {
      result.users_skipped_inflight++
      continue
    }

    if (!needsPortfolioSummaryRegenerate(row, hash)) {
      result.users_skipped_fresh++
      continue
    }

    queue.push(userId)
  }

  const withAge = await Promise.all(
    queue.map(async (userId) => {
      const row = await loadPortfolioSummaryRow(supabase, userId)
      return { userId, generated_at: row?.generated_at ?? '' }
    }),
  )
  withAge.sort((a, b) => a.generated_at.localeCompare(b.generated_at))
  const batch = withAge.slice(0, USERS_PER_RUN).map((x) => x.userId)

  await mapSequential(
    batch,
    async (userId) => {
      result.users_attempted++
      try {
        const payload = await regenerateWithLock(supabase, userId)
        if (payload) {
          result.summaries_written++
          if (payload.narrative_source === 'mechanical') result.mechanical_fallbacks++
        }
      } catch (err) {
        result.errors.push(`${userId}: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    LLM_CALL_DELAY_MS,
  )

  return result
}
