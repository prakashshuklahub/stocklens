/**
 * Build global trending rankings cache (shared by watchlist suggestions + picks discovery).
 */

import { fetchStockFundamentals, mapPool } from '@/lib/fundamentals-fetch'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
import { fetchYahooSector } from '@/lib/sectors'
import { fetchTrendingCandidates } from '@/lib/trending-candidates'
import { ensureSectorBenchmarksLoaded } from '@/lib/sector-benchmarks'
import { isBenchmarkableSector, type BenchmarkableSector } from '@/lib/sector-relative-strength-scoring'
import {
  rankTrendingSuggestions,
  scoreTrendingCandidate,
  TRENDING_GLOBAL_RANK_LIMIT,
  type ScoredSuggestion,
} from '@/lib/watchlist-suggestions-scoring'
import type { createServerClient } from '@/lib/supabase'
import type { CachedTrendingPayload } from '@/lib/trending-cache'
import type { StockFundamentals } from '@/types'

const CANDIDATE_POOL = 100

export async function buildGlobalTrendingCache(
  supabase: ReturnType<typeof createServerClient>,
  options: { skipBlurbs?: boolean } = {},
): Promise<CachedTrendingPayload> {
  const candidates = await fetchTrendingCandidates(CANDIDATE_POOL)
  const tickers = candidates.map((m) => m.ticker)

  const { data: rows } = await supabase.from('stock_fundamentals').select('*').in('ticker', tickers)

  const fundamentalsByTicker = new Map<string, StockFundamentals>()
  for (const row of (rows ?? []) as StockFundamentals[]) {
    fundamentalsByTicker.set(row.ticker, row)
  }

  const missing = tickers.filter((t) => !fundamentalsByTicker.has(t))
  if (missing.length) {
    const fetched = await mapPool(missing, 6, fetchStockFundamentals)
    missing.forEach((t, i) => {
      fundamentalsByTicker.set(t, fetched[i])
    })
    await supabase.from('stock_fundamentals').upsert(
      fetched.map((f) => ({ ...f, fetched_at: new Date().toISOString() })),
      { onConflict: 'ticker' },
    )
  }

  const sectorLoaded = await ensureSectorBenchmarksLoaded(supabase)

  const scored: ScoredSuggestion[] = []
  for (const mover of candidates) {
    let sectorDayDelta: number | null = null
    if (isBenchmarkableSector(mover.sector)) {
      const bench = sectorLoaded.benchmarks[mover.sector as BenchmarkableSector]
      if (bench?.change_1d_pct != null) {
        sectorDayDelta = mover.change_1d_pct - bench.change_1d_pct
      }
    }

    const row = scoreTrendingCandidate({
      mover,
      fundamentals: fundamentalsByTicker.get(mover.ticker) ?? null,
      sectorDayDelta,
    })
    if (row) scored.push(row)
  }

  const ranked = rankTrendingSuggestions(scored, TRENDING_GLOBAL_RANK_LIMIT)
  void ensureLogosForTickers(
    supabase,
    ranked.map((s) => s.ticker),
  ).catch(() => {})

  await Promise.all(
    ranked.map(async (s) => {
      if (s.sector !== 'Other') return
      const sector = await fetchYahooSector(s.ticker)
      if (sector) s.sector = sector
    }),
  )

  const generated_at = new Date().toISOString()
  const payload: CachedTrendingPayload = { ranked, reasons: {}, generated_at }

  const { error: cacheWriteError } = await supabase.from('watchlist_suggestions_cache').upsert(
    {
      cache_key: 'global',
      suggestions: payload,
      generated_at,
    },
    { onConflict: 'cache_key' },
  )
  if (cacheWriteError) {
    console.warn('[trending-cache-build] cache upsert failed:', cacheWriteError.message)
  } else if (!options.skipBlurbs) {
    console.info(`[trending-cache-build] rebuilt trending rankings (${ranked.length} rows)`)
  }

  return payload
}
