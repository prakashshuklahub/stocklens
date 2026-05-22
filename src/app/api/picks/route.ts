// /api/picks — Ranks the user's watchlist into buy recommendations.
//
// Pipeline:
//   1. Load watchlist + cached fundamentals + current portfolio
//   2. Fetch live prices in parallel (Yahoo)
//   3. Score each ticker with pure rules in lib/picks.ts
//   4. Rank, take top N
//   5. For each top pick: check pick_narratives cache (3h TTL),
//      otherwise call Gemini (sequential) and upsert the narrative
//   6. For tickers we couldn't generate LLM narrative, fall back to mechanical

import { auth, getSessionUserId } from '@/lib/auth'
import { loadFundamentalsCacheFirst, refreshFundamentalsForTickers } from '@/lib/load-fundamentals'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
import { fetchLivePricesForTickers } from '@/lib/live-prices'
import { isPriceRefreshActive, isUSMarketOpen } from '@/lib/market-hours'
import { createServerClient } from '@/lib/supabase'
import { fetchNewsForTicker } from '@/lib/news'
import { generateNarrative, isLLMEnabled } from '@/lib/llm'
import {
  loadFreshNarratives,
  MECHANICAL_MODEL,
  narrativeSourceFromModel,
  upsertNarratives,
} from '@/lib/narrative-cache'
import { mechanicalThesis, rankPicks, scorePick, type ScoredPick } from '@/lib/picks'
import { after, NextRequest, NextResponse } from 'next/server'
import type {
  Pick,
  PickOwnership,
  PicksResponse,
  PortfolioHolding,
  StockFundamentals,
  WatchlistStock,
} from '@/types'

const MAX_PICKS = 10
const NO_CACHE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const
const LOG_PREFIX = 'picks'

function latestIso(dates: string[]): string | null {
  if (!dates.length) return null
  return dates.reduce((a, b) => (a > b ? a : b))
}

function emptyPicksResponse(): PicksResponse {
  const now = new Date().toISOString()
  return { picks: [], scores_at: now, narratives_at: null, llm_enabled: isLLMEnabled() }
}

// ── Route ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const marketOpen = isUSMarketOpen()
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })

  const supabase = createServerClient()

  // ── 1. Watchlist + fundamentals + portfolio in parallel ────────────────────
  const [watchlistResult, portfolioResult] = await Promise.all([
    supabase.from('watchlist_stocks').select('*').eq('user_id', userId),
    supabase.from('portfolio_holdings').select('*').eq('user_id', userId),
  ])

  const watchlist = (watchlistResult.data ?? []) as WatchlistStock[]
  if (!watchlist.length) {
    const empty = emptyPicksResponse()
    return NextResponse.json(empty, { headers: NO_CACHE_HEADERS })
  }

  const portfolio = (portfolioResult.data ?? []) as PortfolioHolding[]
  const tickers = watchlist.map((s) => s.ticker)
  const logoTickers = [...new Set([...tickers, ...portfolio.map((h) => h.ticker)])]
  void ensureLogosForTickers(supabase, logoTickers).catch(() => {})

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1' && isPriceRefreshActive()
  const fundamentalsByTicker = new Map<string, StockFundamentals>()
  let fundamentalsCachedCount = 0
  let staleCount = 0
  let tableMissing = false

  const pricesPromise = fetchLivePricesForTickers(tickers)

  let priceByTicker: Map<string, { price: number; change_1d_pct: number }>

  if (forceRefresh) {
    const [loaded, prices] = await Promise.all([
      refreshFundamentalsForTickers(supabase, tickers, { upsert: true }),
      pricesPromise,
    ])
    for (const [t, row] of Object.entries(loaded)) fundamentalsByTicker.set(t, row)
    fundamentalsCachedCount = Object.keys(loaded).length
    priceByTicker = prices
  } else {
    const [cached, prices] = await Promise.all([
      loadFundamentalsCacheFirst(supabase, tickers),
      pricesPromise,
    ])
    tableMissing = cached.tableMissing
    for (const [t, row] of Object.entries(cached.fundamentals)) {
      fundamentalsByTicker.set(t, row)
    }
    fundamentalsCachedCount = Object.keys(cached.fundamentals).length
    staleCount = cached.stale.length
    priceByTicker = prices

    if (tableMissing && fundamentalsByTicker.size < tickers.length * 0.5) {
      const loaded = await refreshFundamentalsForTickers(supabase, tickers, { upsert: false })
      for (const [t, row] of Object.entries(loaded)) fundamentalsByTicker.set(t, row)
    }
    // Target/price cache is maintained by watchlist batch + daily cron — no duplicate refresh here.
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

  // ── 4. Score + rank ────────────────────────────────────────────────────────
  // Track diagnostics so we can explain "no picks" cases.
  const debug = {
    watchlist_size: watchlist.length,
    prices_fetched: priceByTicker.size,
    fundamentals_cached: fundamentalsCachedCount,
    stale_fundamentals: staleCount,
    table_missing: tableMissing,
    missing_fundamentals: 0,
    missing_target_price: 0,
    missing_analyst_data: 0,
    disqualified: 0,
    scored: 0,
    above_threshold: 0,
  }
  const scored: ScoredPick[] = []
  for (const stock of watchlist) {
    const fundamentals = fundamentalsByTicker.get(stock.ticker)
    const current_price = priceByTicker.get(stock.ticker)?.price
    if (!fundamentals) { debug.missing_fundamentals++; continue }
    if (current_price == null) continue
    if (!fundamentals.target_price && !fundamentals.target_mean) debug.missing_target_price++
    const total = (fundamentals.analyst_buy ?? 0) + (fundamentals.analyst_hold ?? 0) + (fundamentals.analyst_sell ?? 0)
    if (total < 3) debug.missing_analyst_data++
    const pick = scorePick({
      stock,
      current_price,
      fundamentals,
      ownership: ownershipByTicker.get(stock.ticker) ?? null,
    })
    if (pick) {
      debug.scored++
      if (pick.score >= 10) debug.above_threshold++
      scored.push(pick)
    } else {
      debug.disqualified++
    }
  }

  const top = rankPicks(scored, MAX_PICKS)
  const scoresAt = new Date().toISOString()
  if (!top.length) {
    const empty = emptyPicksResponse()
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({ ...empty, debug }, { headers: NO_CACHE_HEADERS })
    }
    return NextResponse.json(empty, { headers: NO_CACHE_HEADERS })
  }

  // ── 5. Narrative cache lookup (3h TTL; refresh only updates prices/scores) ──
  const topTickers = top.map((p) => p.ticker.toUpperCase())
  const cachedByTicker = await loadFreshNarratives<{
    ticker: string
    thesis: string
    main_risk: string
    model: string | null
    generated_at: string
  }>(supabase, 'pick_narratives', topTickers, LOG_PREFIX)

  // ── 6. Narratives — cached LLM first; mechanical on miss; LLM generated in background ──
  const llmEnabled = isLLMEnabled()
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

  // Return mechanical narratives immediately so the response is not blocked on Gemini.
  const generated: GenResult[] = needGeneration.map((pick) => {
    const fallback = mechanicalThesis(pick)
    return { ticker: pick.ticker, ...fallback, source: 'mechanical', model: null }
  })

  if (llmEnabled && needGeneration.length) {
    after(async () => {
      const headlinesByTicker = new Map<string, string[]>()
      const headlineResults = await Promise.all(
        needGeneration.map((p) => fetchNewsForTicker(p.ticker)),
      )
      needGeneration.forEach((p, i) => {
        const items = (headlineResults[i] ?? [])
          .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
          .slice(0, 3)
          .map((n) => n.title)
        headlinesByTicker.set(p.ticker, items)
      })

      const llmRows: {
        ticker: string
        thesis: string
        main_risk: string
        model: string
        generated_at: string
      }[] = []

      for (const pick of needGeneration) {
        const f = fundamentalsByTicker.get(pick.ticker)
        if (!f) continue
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
          llmRows.push({
            ticker: pick.ticker.toUpperCase(),
            thesis: narrative.thesis,
            main_risk: narrative.main_risk,
            model: narrative.model,
            generated_at: new Date().toISOString(),
          })
        }
      }

      if (llmRows.length) {
        await upsertNarratives(supabase, 'pick_narratives', llmRows, LOG_PREFIX)
      }
    })
  }

  // Persist mechanical placeholders immediately; background LLM overwrites when ready.
  if (generated.length) {
    const narrativeRows = generated.map((g) => ({
      ticker: g.ticker.toUpperCase(),
      thesis: g.thesis,
      main_risk: g.main_risk,
      model: MECHANICAL_MODEL,
      generated_at: new Date().toISOString(),
    }))
    await upsertNarratives(supabase, 'pick_narratives', narrativeRows, LOG_PREFIX)
  }

  // ── 7. Final response ──────────────────────────────────────────────────────
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
    }
  })

  const response: PicksResponse = {
    picks,
    scores_at: scoresAt,
    narratives_at: latestIso(narrativeTimes),
    llm_enabled: llmEnabled,
  }
  return NextResponse.json(response, { headers: NO_CACHE_HEADERS })
}
