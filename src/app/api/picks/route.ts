// /api/picks — Two sections: your watchlist/portfolio (5) + market discovery (5).
//
// Pipeline:
//   1. Load watchlist + portfolio + cached fundamentals + sector benchmarks
//   2. Fetch live prices (Yahoo)
//   3. Score section 1 from watchlist ∪ portfolio; section 2 from global trending cache
//   4. Rank top 5 each; attach narratives (Gemini sync on cache miss, 3h TTL)

import { auth, getSessionUserId } from '@/lib/auth'
import { loadFundamentalsCacheFirst, refreshFundamentalsForTickers } from '@/lib/load-fundamentals'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
import { fetchLivePricesForTickers, type LivePriceSnapshot } from '@/lib/live-prices'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { createServerClient } from '@/lib/supabase'
import { fetchNewsForTicker } from '@/lib/news'
import { generateNarrative, isLLMEnabled } from '@/lib/llm'
import {
  loadFreshNarratives,
  mapSequential,
  MECHANICAL_MODEL,
  narrativeSourceFromModel,
  upsertNarratives,
} from '@/lib/narrative-cache'
import { ensureSectorBenchmarksLoaded } from '@/lib/sector-benchmarks'
import { isBenchmarkableSector, type BenchmarkableSector } from '@/lib/sector-relative-strength-scoring'
import { loadTrendingCachePayload } from '@/lib/trending-cache'
import { buildGlobalTrendingCache } from '@/lib/trending-cache-build'
import { normalizeWatchlistSector } from '@/lib/sector-relative-strength-scoring'
import {
  mechanicalThesis,
  rankDiscoveryPicks,
  rankPicks,
  scoreDiscoveryPick,
  scorePick,
  PICKS_DISCOVERY_MAX,
  PICKS_MAX_RESULTS,
  type PickCandidate,
  type ScoredPick,
} from '@/lib/picks'
import { NextRequest, NextResponse } from 'next/server'
import type {
  Pick,
  PickOwnership,
  PicksResponse,
  PortfolioHolding,
  SectorBenchmark,
  StockFundamentals,
  WatchlistStock,
} from '@/types'

const NO_CACHE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const
const LOG_PREFIX = 'picks'

function latestIso(dates: string[]): string | null {
  if (!dates.length) return null
  return dates.reduce((a, b) => (a > b ? a : b))
}

function emptyPicksResponse(): PicksResponse {
  const now = new Date().toISOString()
  return {
    your_picks: [],
    discovery_picks: [],
    picks: [],
    scores_at: now,
    narratives_at: null,
    llm_enabled: isLLMEnabled(),
    sector_benchmarks: {},
  }
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

function sectorForBenchmark(sector: string | null | undefined) {
  const normalized = normalizeWatchlistSector(sector)
  return isBenchmarkableSector(normalized) ? normalized : null
}

function buildCandidates(
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

async function attachNarratives(
  supabase: ReturnType<typeof createServerClient>,
  top: ScoredPick[],
  fundamentalsByTicker: Map<string, StockFundamentals>,
  scoresAt: string,
): Promise<{ picks: Pick[]; narrativeTimes: string[] }> {
  if (!top.length) return { picks: [], narrativeTimes: [] }

  const topTickers = top.map((p) => p.ticker.toUpperCase())
  const llmEnabled = isLLMEnabled()
  const cachedByTicker = await loadFreshNarratives<{
    ticker: string
    thesis: string
    main_risk: string
    model: string | null
    generated_at: string
  }>(supabase, 'pick_narratives', topTickers, LOG_PREFIX)

  // Stale mechanical rows (from old async flow) should not block a fresh Gemini pass.
  if (llmEnabled) {
    for (const [ticker, row] of cachedByTicker) {
      if (row.model === MECHANICAL_MODEL) cachedByTicker.delete(ticker)
    }
  }

  const needGeneration = top.filter((p) => !cachedByTicker.has(p.ticker.toUpperCase()))

  if (needGeneration.length) {
    console.info(
      `[${LOG_PREFIX}] narratives cache: ${cachedByTicker.size} hit, ${needGeneration.length} miss`,
    )
  }

  type GenResult = {
    ticker: string
    thesis: string
    main_risk: string
    source: 'llm' | 'mechanical'
    model: string | null
  }

  const headlinesByTicker = new Map<string, string[]>()
  if (needGeneration.length) {
    const headlineResults = await Promise.all(needGeneration.map((p) => fetchNewsForTicker(p.ticker)))
    needGeneration.forEach((p, i) => {
      const items = (headlineResults[i] ?? [])
        .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
        .slice(0, 3)
        .map((n) => n.title)
      headlinesByTicker.set(p.ticker, items)
    })
  }

  const generated: GenResult[] = needGeneration.length
    ? await mapSequential(needGeneration, async (pick): Promise<GenResult> => {
        const f = fundamentalsByTicker.get(pick.ticker)
        if (llmEnabled && f) {
          const narrative = await generateNarrative({
            ticker: pick.ticker,
            company_name: pick.company_name,
            sector: pick.sector,
            target_label: pick.target_label,
            current_price: pick.current_price,
            target_mean: pick.target_mean,
            target_low: pick.target_low,
            target_high: pick.target_high,
            upside_pct: pick.upside_pct,
            analyst_buy: pick.analyst_buy,
            analyst_hold: pick.analyst_hold,
            analyst_sell: pick.analyst_sell,
            analyst_total: pick.analyst_total,
            change_7d_pct: f.change_7d_pct,
            change_30d_pct: f.change_30d_pct,
            week52_high: f.week52_high,
            week52_low: f.week52_low,
            news_sentiment: f.news_sentiment,
            factors: pick.factors.map((x) => x.label),
            recent_headlines: headlinesByTicker.get(pick.ticker) ?? [],
          })
          if (narrative) {
            return {
              ticker: pick.ticker,
              thesis: narrative.thesis,
              main_risk: narrative.main_risk,
              source: 'llm',
              model: narrative.model,
            }
          }
        }
        const fallback = mechanicalThesis(pick)
        return { ticker: pick.ticker, ...fallback, source: 'mechanical', model: null }
      })
    : []

  if (generated.length) {
    const narrativeRows = generated.map((g) => ({
      ticker: g.ticker.toUpperCase(),
      thesis: g.thesis,
      main_risk: g.main_risk,
      model: g.source === 'llm' && g.model ? g.model : MECHANICAL_MODEL,
      generated_at: new Date().toISOString(),
    }))
    await upsertNarratives(supabase, 'pick_narratives', narrativeRows, LOG_PREFIX)
  }

  const generatedByTicker = new Map<string, GenResult>()
  for (const g of generated) generatedByTicker.set(g.ticker, g)

  const narrativeTimes: string[] = []
  const picks: Pick[] = top.map((p) => {
    const key = p.ticker.toUpperCase()
    const cached = cachedByTicker.get(key)
    const fresh = generatedByTicker.get(p.ticker)
    const narrative = cached ?? fresh
    if (cached?.generated_at) narrativeTimes.push(cached.generated_at)
    else if (fresh) narrativeTimes.push(scoresAt)

    return {
      ...p,
      thesis: narrative?.thesis ?? null,
      main_risk: narrative?.main_risk ?? null,
      narrative_source:
        fresh?.source ?? (cached ? narrativeSourceFromModel(cached.model) : 'mechanical'),
      narrative_generated_at: cached?.generated_at ?? (fresh ? scoresAt : null),
    }
  })

  return { picks, narrativeTimes }
}

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })

  const supabase = createServerClient()

  const [watchlistResult, portfolioResult] = await Promise.all([
    supabase.from('watchlist_stocks').select('*').eq('user_id', userId),
    supabase.from('portfolio_holdings').select('*').eq('user_id', userId),
  ])

  const watchlist = (watchlistResult.data ?? []) as WatchlistStock[]
  const portfolio = (portfolioResult.data ?? []) as PortfolioHolding[]
  const candidates = buildCandidates(watchlist, portfolio)

  if (!candidates.length) {
    return NextResponse.json(emptyPicksResponse(), { headers: NO_CACHE_HEADERS })
  }

  const candidateTickers = candidates.map((c) => c.ticker)
  const ownedTickers = new Set(candidateTickers.map((t) => t.toUpperCase()))
  void ensureLogosForTickers(supabase, candidateTickers).catch(() => {})

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1' && isPriceRefreshActive()
  const fundamentalsByTicker = new Map<string, StockFundamentals>()

  const sectorLoaded = await ensureSectorBenchmarksLoaded(supabase)
  const sectorBenchmarks = sectorLoaded.benchmarks

  const pricesPromise = fetchLivePricesForTickers(candidateTickers)
  let priceByTicker: Map<string, LivePriceSnapshot>

  if (forceRefresh) {
    const [loaded, prices] = await Promise.all([
      refreshFundamentalsForTickers(supabase, candidateTickers, { upsert: true }),
      pricesPromise,
    ])
    for (const [t, row] of Object.entries(loaded)) fundamentalsByTicker.set(t, row)
    priceByTicker = prices
  } else {
    const [cached, prices] = await Promise.all([
      loadFundamentalsCacheFirst(supabase, candidateTickers),
      pricesPromise,
    ])
    for (const [t, row] of Object.entries(cached.fundamentals)) {
      fundamentalsByTicker.set(t, row)
    }
    priceByTicker = prices

    if (cached.tableMissing && fundamentalsByTicker.size < candidateTickers.length * 0.5) {
      const loaded = await refreshFundamentalsForTickers(supabase, candidateTickers, { upsert: false })
      for (const [t, row] of Object.entries(loaded)) fundamentalsByTicker.set(t, row)
    }
  }

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

  const scoredYour: ScoredPick[] = []
  for (const raw of candidates) {
    const live = priceByTicker.get(raw.ticker)
    const current_price = live?.price
    if (current_price == null) continue

    const candidate = resolveCandidateSector(raw, live)
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
    if (pick) scoredYour.push(pick)
  }

  const topYour = rankPicks(scoredYour, PICKS_MAX_RESULTS)

  // ── Discovery section — trending cache + live prices before day-move gate ──
  let scoredDiscovery: ScoredPick[] = []
  let trendingCache = await loadTrendingCachePayload(supabase)
  if (!trendingCache?.ranked.length) {
    try {
      trendingCache = await buildGlobalTrendingCache(supabase, { skipBlurbs: true })
    } catch (err) {
      console.warn('[picks] trending cache rebuild failed:', err)
    }
  }

  if (trendingCache?.ranked.length) {
    const discoveryMovers = trendingCache.ranked.filter(
      (s) => !ownedTickers.has(s.ticker.toUpperCase()),
    )
    const discoveryTickers = discoveryMovers.map((s) => s.ticker)

    if (discoveryTickers.length) {
      void ensureLogosForTickers(supabase, discoveryTickers).catch(() => {})
      const discoveryPrices = await fetchLivePricesForTickers(discoveryTickers)
      const missingFundamentals = discoveryTickers.filter((t) => !fundamentalsByTicker.has(t))

      if (missingFundamentals.length) {
        const extra = await loadFundamentalsCacheFirst(supabase, missingFundamentals)
        for (const [t, row] of Object.entries(extra.fundamentals)) {
          fundamentalsByTicker.set(t, row)
        }
      }

      for (const mover of discoveryMovers) {
        const live = discoveryPrices.get(mover.ticker)
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
        if (pick) scoredDiscovery.push(pick)
      }
    }
  }

  const topDiscovery = rankDiscoveryPicks(scoredDiscovery, PICKS_DISCOVERY_MAX)
  const scoresAt = new Date().toISOString()

  const allTop = [...topYour, ...topDiscovery]
  const narrativeFundamentals = new Map(fundamentalsByTicker)

  const [yourResult, discoveryResult] = await Promise.all([
    attachNarratives(supabase, topYour, narrativeFundamentals, scoresAt),
    attachNarratives(supabase, topDiscovery, narrativeFundamentals, scoresAt),
  ])

  const response: PicksResponse = {
    your_picks: yourResult.picks,
    discovery_picks: discoveryResult.picks,
    picks: yourResult.picks,
    scores_at: scoresAt,
    narratives_at: latestIso([...yourResult.narrativeTimes, ...discoveryResult.narrativeTimes]),
    llm_enabled: isLLMEnabled(),
    sector_benchmarks: Object.fromEntries(
      Object.entries(sectorBenchmarks).filter((entry): entry is [string, SectorBenchmark] => entry[1] != null),
    ),
  }

  return NextResponse.json(response, { headers: NO_CACHE_HEADERS })
}
