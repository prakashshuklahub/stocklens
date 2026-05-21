// /api/picks — Ranks the user's watchlist into buy recommendations.
//
// Pipeline:
//   1. Load watchlist + cached fundamentals + current portfolio
//   2. Fetch live prices in parallel (Yahoo)
//   3. Score each ticker with pure rules in lib/picks.ts
//   4. Rank, take top N
//   5. For each top pick: check pick_narratives cache (6h TTL),
//      otherwise call Groq (in parallel) and upsert the narrative
//   6. For tickers we couldn't generate LLM narrative, fall back to mechanical

import { auth } from '@/lib/auth'
import { fetchStockFundamentals, mapPool } from '@/lib/fundamentals-fetch'
import { createServerClient } from '@/lib/supabase'
import { fetchNewsForTicker } from '@/lib/news'
import { generateNarrative, isLLMEnabled } from '@/lib/llm'
import { mechanicalThesis, rankPicks, scorePick, type ScoredPick } from '@/lib/picks'
import { NextRequest, NextResponse } from 'next/server'
import type {
  Pick,
  PickOwnership,
  PicksResponse,
  PortfolioHolding,
  StockFundamentals,
  WatchlistStock,
} from '@/types'

const MAX_PICKS = 10
const NARRATIVE_TTL_HOURS = 6
const NO_CACHE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const

// ── Live price (same pattern as /api/watchlist) ──────────────────────────────
async function fetchOnePrice(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }
    )
    if (!res.ok) return null
    const data = await res.json()
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice
    return typeof price === 'number' ? price : null
  } catch {
    return null
  }
}

// ── Route ────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1'
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  const userId = session.user.id

  // ── 1. Watchlist + fundamentals + portfolio in parallel ────────────────────
  const [watchlistResult, portfolioResult] = await Promise.all([
    supabase.from('watchlist_stocks').select('*').eq('user_id', userId),
    supabase.from('portfolio_holdings').select('*').eq('user_id', userId),
  ])

  const watchlist = (watchlistResult.data ?? []) as WatchlistStock[]
  if (!watchlist.length) {
    const empty: PicksResponse = { picks: [], generated_at: new Date().toISOString(), llm_enabled: isLLMEnabled() }
    return NextResponse.json(empty, { headers: NO_CACHE_HEADERS })
  }

  const portfolio = (portfolioResult.data ?? []) as PortfolioHolding[]
  const tickers = watchlist.map((s) => s.ticker)

  const { data: fundamentalsRows, error: fundamentalsError } = await supabase
    .from('stock_fundamentals')
    .select('*')
    .in('ticker', tickers)

  if (fundamentalsError) {
    console.error('[picks] stock_fundamentals SELECT failed:', fundamentalsError.message)
  }

  const fundamentalsByTicker = new Map<string, StockFundamentals>()
  for (const row of (fundamentalsRows ?? []) as StockFundamentals[]) {
    fundamentalsByTicker.set(row.ticker, row)
  }

  // If DB table is missing or empty, hydrate live from Yahoo + Finnhub (no cache).
  const tableMissing = Boolean(
    fundamentalsError?.message?.includes('PGRST205') ||
    fundamentalsError?.message?.includes('stock_fundamentals')
  )
  const needLive =
    forceRefresh || tableMissing || fundamentalsByTicker.size < tickers.length * 0.5
  let hydratedLive = 0
  if (needLive) {
    const toFetch = forceRefresh
      ? tickers
      : tickers.filter((t) => !fundamentalsByTicker.has(t))
    const fetched = await mapPool(toFetch, 6, fetchStockFundamentals)
    toFetch.forEach((t, i) => {
      fundamentalsByTicker.set(t, fetched[i])
      hydratedLive++
    })
    // Best-effort cache write when table exists
    if (!tableMissing && fetched.length) {
      await supabase.from('stock_fundamentals').upsert(
        fetched.map((f) => ({ ...f, fetched_at: new Date().toISOString() })),
        { onConflict: 'ticker' }
      )
    }
  }

  // ── 2. Live prices in parallel ──────────────────────────────────────────────
  const prices = await Promise.all(tickers.map(fetchOnePrice))
  const priceByTicker = new Map<string, number>()
  tickers.forEach((t, i) => {
    if (prices[i] != null) priceByTicker.set(t, prices[i]!)
  })

  // ── 3. Portfolio lookup → ownership context ────────────────────────────────
  const ownershipByTicker = new Map<string, PickOwnership>()
  for (const h of portfolio) {
    const price = priceByTicker.get(h.ticker)
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
    fundamentals_cached: (fundamentalsRows ?? []).length,
    hydrated_live: hydratedLive,
    table_missing: tableMissing,
    missing_fundamentals: 0,
    missing_target_mean: 0,
    missing_analyst_data: 0,
    disqualified: 0,
    scored: 0,
    above_threshold: 0,
  }
  const scored: ScoredPick[] = []
  for (const stock of watchlist) {
    const fundamentals = fundamentalsByTicker.get(stock.ticker)
    const current_price = priceByTicker.get(stock.ticker)
    if (!fundamentals) { debug.missing_fundamentals++; continue }
    if (current_price == null) continue
    if (!fundamentals.target_mean) debug.missing_target_mean++
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
  if (!top.length) {
    const empty: PicksResponse = {
      picks: [],
      generated_at: new Date().toISOString(),
      llm_enabled: isLLMEnabled(),
    }
    if (process.env.NODE_ENV !== 'production') {
      return NextResponse.json({ ...empty, debug }, { headers: NO_CACHE_HEADERS })
    }
    return NextResponse.json(empty, { headers: NO_CACHE_HEADERS })
  }

  // ── 5. Narrative cache lookup (skipped on manual refresh) ───────────────────
  const cachedByTicker = new Map<string, { thesis: string; main_risk: string }>()
  if (!forceRefresh) {
    const topTickers = top.map((p) => p.ticker)
    const ttlCutoff = new Date(Date.now() - NARRATIVE_TTL_HOURS * 3600 * 1000).toISOString()
    const { data: narrativeRows } = await supabase
      .from('pick_narratives')
      .select('*')
      .in('ticker', topTickers)
      .gte('generated_at', ttlCutoff)

    for (const r of (narrativeRows ?? []) as Array<{ ticker: string; thesis: string; main_risk: string }>) {
      cachedByTicker.set(r.ticker, { thesis: r.thesis, main_risk: r.main_risk })
    }
  }

  // ── 6. Generate missing narratives (LLM or mechanical) ─────────────────────
  const llmEnabled = isLLMEnabled()
  const needGeneration = forceRefresh
    ? top
    : top.filter((p) => !cachedByTicker.has(p.ticker))

  // Fetch a few recent headlines for each pick that needs an LLM narrative.
  // (Mechanical fallback doesn't use headlines.)
  const headlinesByTicker = new Map<string, string[]>()
  if (llmEnabled && needGeneration.length) {
    const headlineResults = await Promise.all(
      needGeneration.map((p) => fetchNewsForTicker(p.ticker))
    )
    needGeneration.forEach((p, i) => {
      const items = (headlineResults[i] ?? [])
        .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
        .slice(0, 3)
        .map((n) => n.title)
      headlinesByTicker.set(p.ticker, items)
    })
  }

  type GenResult = {
    ticker: string
    thesis: string
    main_risk: string
    source: 'llm' | 'mechanical'
    model: string | null
  }
  const generated: GenResult[] = await Promise.all(
    needGeneration.map(async (pick): Promise<GenResult> => {
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
  )

  // Persist successful LLM narratives so we don't re-spend within TTL.
  const llmRows = generated
    .filter((g): g is GenResult & { source: 'llm'; model: string } => g.source === 'llm' && g.model !== null)
    .map((g) => ({
      ticker: g.ticker,
      thesis: g.thesis,
      main_risk: g.main_risk,
      model: g.model,
      generated_at: new Date().toISOString(),
    }))
  if (llmRows.length) {
    await supabase.from('pick_narratives').upsert(llmRows, { onConflict: 'ticker' })
  }

  // ── 7. Final response ──────────────────────────────────────────────────────
  const generatedByTicker = new Map<string, GenResult>()
  for (const g of generated) generatedByTicker.set(g.ticker, g)

  const picks: Pick[] = top.map((p) => {
    const cached = cachedByTicker.get(p.ticker)
    const fresh = generatedByTicker.get(p.ticker)
    const narrative = cached ?? fresh
    return {
      ...p,
      thesis: narrative?.thesis ?? null,
      main_risk: narrative?.main_risk ?? null,
      narrative_source: fresh?.source ?? 'llm',
    }
  })

  const response: PicksResponse = {
    picks,
    generated_at: new Date().toISOString(),
    llm_enabled: llmEnabled,
  }
  return NextResponse.json(response, { headers: NO_CACHE_HEADERS })
}
