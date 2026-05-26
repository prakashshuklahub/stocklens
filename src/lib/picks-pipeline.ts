import { loadFundamentalsCacheFirst, refreshFundamentalsForTickers } from '@/lib/load-fundamentals'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
import { fetchLivePricesForTickers, type LivePriceSnapshot } from '@/lib/live-prices'
import { isLLMEnabled } from '@/lib/llm'
import {
  attachPickNarratives,
  loadCachedPickNarratives,
  schedulePickNarrativeGeneration,
} from '@/lib/pick-narratives'
import { ensureSectorBenchmarksLoaded } from '@/lib/sector-benchmarks'
import { isBenchmarkableSector, normalizeWatchlistSector, type BenchmarkableSector } from '@/lib/sector-relative-strength-scoring'
import { loadTrendingCachePayload } from '@/lib/trending-cache'
import { buildGlobalTrendingCache } from '@/lib/trending-cache-build'
import { fetchYahooSector } from '@/lib/sectors'
import {
  rankAllPicks,
  scoreDiscoveryPick,
  scorePick,
  PICKS_MAX_RESULTS,
  type PickCandidate,
  type ScoredPick,
} from '@/lib/picks'
import type { createServerClient } from '@/lib/supabase'
import type {
  Pick,
  PickOwnership,
  PicksResponse,
  PortfolioHolding,
  SectorBenchmark,
  SignalNewsItem,
  StockFundamentals,
  WatchlistStock,
} from '@/types'

type Supabase = ReturnType<typeof createServerClient>

export const PICKS_NO_CACHE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const

const EMPTY_NEWS = new Map<string, SignalNewsItem[]>()

export function latestIso(dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => Boolean(d))
  if (!valid.length) return null
  return valid.reduce((a, b) => (a > b ? a : b))
}

function emptyPicksResponse(): PicksResponse {
  const now = new Date().toISOString()
  return {
    picks: [],
    your_picks: [],
    discovery_picks: [],
    scores_at: now,
    narratives_at: null,
    llm_enabled: isLLMEnabled(),
    sector_benchmarks: {},
  }
}

function sectorBenchmarksRecord(
  benchmarks: Partial<Record<BenchmarkableSector, SectorBenchmark | null>>,
): Record<string, SectorBenchmark> {
  return Object.fromEntries(
    Object.entries(benchmarks).filter((entry): entry is [string, SectorBenchmark] => entry[1] != null),
  )
}

function resolveCandidateSector(
  candidate: PickCandidate,
  live: LivePriceSnapshot | undefined,
): PickCandidate {
  if (candidate.sector) return candidate
  const fromQuote = live?.sector
  if (fromQuote && fromQuote !== 'Other') {
    return { ...candidate, sector: fromQuote }
  }
  return candidate
}

async function enrichCandidatesWithSector(
  candidates: PickCandidate[],
  priceByTicker: Map<string, LivePriceSnapshot>,
): Promise<PickCandidate[]> {
  const withQuote = candidates.map((c) => resolveCandidateSector(c, priceByTicker.get(c.ticker)))
  const needFetch = withQuote.filter(
    (c) => !c.sector || normalizeWatchlistSector(c.sector) === 'Other',
  )
  if (!needFetch.length) return withQuote

  const fetched = await Promise.all(
    needFetch.map(async (c) => ({
      key: c.ticker.toUpperCase(),
      sector: await fetchYahooSector(c.ticker),
    })),
  )
  const byTicker = new Map(
    fetched
      .filter((r) => r.sector && r.sector !== 'Other')
      .map((r) => [r.key, r.sector!]),
  )

  return withQuote.map((c) => {
    const sector = byTicker.get(c.ticker.toUpperCase())
    if (sector && (!c.sector || normalizeWatchlistSector(c.sector) === 'Other')) {
      return { ...c, sector }
    }
    return c
  })
}

function sectorForBenchmark(sector: string | null | undefined) {
  const normalized = normalizeWatchlistSector(sector)
  return isBenchmarkableSector(normalized) ? normalized : null
}

export function buildCandidates(
  watchlist: WatchlistStock[],
  portfolio: PortfolioHolding[],
): PickCandidate[] {
  const byTicker = new Map<string, PickCandidate>()

  for (const w of watchlist) {
    const key = w.ticker.toUpperCase()
    byTicker.set(key, {
      ticker: w.ticker,
      company_name: w.company_name,
      sector: w.sector,
      source: 'watchlist',
    })
  }

  for (const h of portfolio) {
    const key = h.ticker.toUpperCase()
    const existing = byTicker.get(key)
    if (existing) {
      existing.source = 'both'
      if (!existing.company_name && h.company_name) existing.company_name = h.company_name
    } else {
      byTicker.set(key, {
        ticker: h.ticker,
        company_name: h.company_name ?? h.ticker,
        sector: null,
        source: 'portfolio',
      })
    }
  }

  return [...byTicker.values()]
}

async function loadFundamentalsAndPrices(
  supabase: Supabase,
  tickers: string[],
  forceRefresh: boolean,
): Promise<{
  fundamentalsByTicker: Map<string, StockFundamentals>
  priceByTicker: Map<string, LivePriceSnapshot>
}> {
  const fundamentalsByTicker = new Map<string, StockFundamentals>()
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))]
  if (!unique.length) {
    return { fundamentalsByTicker, priceByTicker: new Map() }
  }

  const pricesPromise = fetchLivePricesForTickers(unique)

  if (forceRefresh) {
    const [loaded, prices] = await Promise.all([
      refreshFundamentalsForTickers(supabase, unique, { upsert: true }),
      pricesPromise,
    ])
    for (const [t, row] of Object.entries(loaded)) fundamentalsByTicker.set(t, row)
    return { fundamentalsByTicker, priceByTicker: prices }
  }

  const [cached, prices] = await Promise.all([
    loadFundamentalsCacheFirst(supabase, unique),
    pricesPromise,
  ])
  for (const [t, row] of Object.entries(cached.fundamentals)) {
    fundamentalsByTicker.set(t, row)
  }

  if (cached.tableMissing && fundamentalsByTicker.size < unique.length * 0.5) {
    const loaded = await refreshFundamentalsForTickers(supabase, unique, { upsert: false })
    for (const [t, row] of Object.entries(loaded)) fundamentalsByTicker.set(t, row)
  }

  return { fundamentalsByTicker, priceByTicker: prices }
}

async function finalizePicks(
  supabase: Supabase,
  top: ScoredPick[],
  fundamentalsByTicker: Map<string, StockFundamentals>,
  scoresAt: string,
  logPrefix: string,
): Promise<{ picks: Pick[]; narrativeTimes: string[] }> {
  if (!top.length) return { picks: [], narrativeTimes: [] }

  const cachedNarratives = await loadCachedPickNarratives(
    supabase,
    top.map((p) => p.ticker.toUpperCase()),
    logPrefix,
  )
  const result = attachPickNarratives(top, cachedNarratives, EMPTY_NEWS, scoresAt)
  schedulePickNarrativeGeneration(supabase, result.pendingLlm, fundamentalsByTicker, logPrefix)
  return { picks: result.picks, narrativeTimes: result.narrativeTimes }
}

/** Score watchlist + portfolio + strong movers together; return global top 10 by score. */
export async function buildUnifiedPicksResponse(
  supabase: Supabase,
  userId: string,
  forceRefresh: boolean,
  logPrefix = 'picks',
): Promise<PicksResponse> {
  const [watchlistResult, portfolioResult, sectorLoaded, trendingCacheInitial] = await Promise.all([
    supabase.from('watchlist_stocks').select('*').eq('user_id', userId),
    supabase.from('portfolio_holdings').select('*').eq('user_id', userId),
    ensureSectorBenchmarksLoaded(supabase),
    loadTrendingCachePayload(supabase),
  ])

  const watchlist = (watchlistResult.data ?? []) as WatchlistStock[]
  const portfolio = (portfolioResult.data ?? []) as PortfolioHolding[]
  const candidates = buildCandidates(watchlist, portfolio)
  const ownedTickers = new Set(candidates.map((c) => c.ticker.toUpperCase()))

  const sectorBenchmarks = sectorLoaded.benchmarks

  let trendingCache = trendingCacheInitial
  if (!trendingCache?.ranked.length) {
    try {
      trendingCache = await buildGlobalTrendingCache(supabase, { skipBlurbs: true })
    } catch (err) {
      console.warn('[picks] trending cache rebuild failed:', err)
    }
  }

  const discoveryMovers =
    trendingCache?.ranked.filter((s) => !ownedTickers.has(s.ticker.toUpperCase())) ?? []

  const candidateTickers = candidates.map((c) => c.ticker)
  const discoveryTickers = discoveryMovers.map((s) => s.ticker)
  const allTickers = [...new Set([...candidateTickers, ...discoveryTickers].map((t) => t.toUpperCase()))]

  if (!allTickers.length) return emptyPicksResponse()

  void ensureLogosForTickers(supabase, allTickers).catch(() => {})

  const { fundamentalsByTicker, priceByTicker } = await loadFundamentalsAndPrices(
    supabase,
    allTickers,
    forceRefresh,
  )

  const ownershipByTicker = new Map<string, PickOwnership>()
  for (const h of portfolio) {
    const price = priceByTicker.get(h.ticker)?.price
    if (price != null) {
      ownershipByTicker.set(h.ticker, {
        shares: h.quantity,
        avg_cost_basis: h.avg_cost_basis,
        current_value: price * h.quantity,
      })
    }
  }

  const scoredAll: ScoredPick[] = []

  if (candidates.length) {
    const yourCandidates = await enrichCandidatesWithSector(candidates, priceByTicker)
    for (const candidate of yourCandidates) {
      const live = priceByTicker.get(candidate.ticker)
      const current_price = live?.price
      if (current_price == null) continue

      const fundamentals = fundamentalsByTicker.get(candidate.ticker)
      if (!fundamentals) continue

      const sector = sectorForBenchmark(candidate.sector)
      const benchmark = sector ? sectorBenchmarks[sector as BenchmarkableSector] ?? null : null

      const pick = scorePick({
        candidate,
        current_price,
        change_1d_pct: live?.change_1d_pct ?? null,
        change_1d_session: live?.session,
        fundamentals,
        ownership: ownershipByTicker.get(candidate.ticker) ?? null,
        benchmark,
      })
      if (pick) scoredAll.push(pick)
    }
  }

  for (const mover of discoveryMovers) {
    const live = priceByTicker.get(mover.ticker)
    if (live?.price == null || live.change_1d_pct == null) continue

    const price = live.price
    const d1 = live.change_1d_pct
    const sector =
      mover.sector !== 'Other'
        ? mover.sector
        : live.sector && live.sector !== 'Other'
          ? live.sector
          : mover.sector

    const f = fundamentalsByTicker.get(mover.ticker)
    const benchmarkSector = sectorForBenchmark(sector)
    const benchmark = benchmarkSector
      ? sectorBenchmarks[benchmarkSector as BenchmarkableSector] ?? null
      : null

    const pick = scoreDiscoveryPick({
      mover: {
        ticker: mover.ticker,
        company_name: mover.company_name,
        sector,
        price,
        change_1d_pct: d1,
        source: mover.source,
      },
      current_price: price,
      change_1d_pct: d1,
      change_1d_session: live.session,
      fundamentals: f ?? null,
      benchmark,
    })
    if (pick) scoredAll.push(pick)
  }

  const top = rankAllPicks(scoredAll, PICKS_MAX_RESULTS)
  const scoresAt = new Date().toISOString()
  const { picks, narrativeTimes } = await finalizePicks(
    supabase,
    top,
    fundamentalsByTicker,
    scoresAt,
    logPrefix,
  )

  return {
    picks,
    your_picks: picks.filter((p) => p.source !== 'discovery'),
    discovery_picks: picks.filter((p) => p.source === 'discovery'),
    scores_at: scoresAt,
    narratives_at: latestIso(narrativeTimes),
    llm_enabled: isLLMEnabled(),
    sector_benchmarks: sectorBenchmarksRecord(sectorBenchmarks),
  }
}
