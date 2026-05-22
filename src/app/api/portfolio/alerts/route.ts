import { auth, getSessionUserId } from '@/lib/auth'
import { loadFundamentalsForTickers } from '@/lib/load-fundamentals'
import { fetchLivePricesForTickers } from '@/lib/live-prices'
import { isPriceRefreshActive, isUSMarketOpen } from '@/lib/market-hours'
import { generateSellReview, isLLMEnabled } from '@/lib/llm'
import {
  loadFreshNarratives,
  mapSequential,
  MECHANICAL_MODEL,
  narrativeSourceFromModel,
  upsertNarratives,
} from '@/lib/narrative-cache'
import {
  mechanicalSellReview,
  rankAlerts,
  scorePortfolioAlert,
  type ScoredAlert,
} from '@/lib/portfolio-alerts'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import type {
  PortfolioAlert,
  PortfolioAlertsResponse,
  PortfolioHolding,
  StockFundamentals,
} from '@/types'

const NO_CACHE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const
const LOG_PREFIX = 'portfolio/alerts'

export async function GET(req: NextRequest) {
  const marketOpen = isUSMarketOpen()
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1' && isPriceRefreshActive()
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })

  const supabase = createServerClient()

  const { data: holdings, error } = await supabase
    .from('portfolio_holdings')
    .select('*')
    .eq('user_id', userId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const list = (holdings ?? []) as PortfolioHolding[]
  if (!list.length) {
    const empty: PortfolioAlertsResponse = {
      alerts: [],
      clear_count: 0,
      holding_count: 0,
      generated_at: new Date().toISOString(),
      llm_enabled: isLLMEnabled(),
    }
    return NextResponse.json(empty, { headers: NO_CACHE_HEADERS })
  }

  const tickers = list.map((h) => h.ticker)

  const { data: fundamentalsRows, error: fundamentalsError } = await supabase
    .from('stock_fundamentals')
    .select('*')
    .in('ticker', tickers)

  const fundamentalsByTicker = new Map<string, StockFundamentals>()
  for (const row of (fundamentalsRows ?? []) as StockFundamentals[]) {
    fundamentalsByTicker.set(row.ticker, row)
  }

  const tableMissing = Boolean(
    fundamentalsError?.message?.includes('PGRST205') ||
    fundamentalsError?.message?.includes('stock_fundamentals'),
  )

  const needFundamentals =
    tableMissing || fundamentalsByTicker.size < tickers.length || forceRefresh
  if (needFundamentals) {
    const loaded = await loadFundamentalsForTickers(supabase, tickers, { upsert: !tableMissing })
    for (const [t, row] of Object.entries(loaded)) {
      fundamentalsByTicker.set(t, row)
    }
  }

  const priceMap = await fetchLivePricesForTickers(tickers)
  const scored: ScoredAlert[] = []

  for (const holding of list) {
    const price = priceMap.get(holding.ticker.toUpperCase())?.price ?? null
    if (price == null) continue
    const alert = scorePortfolioAlert({
      holding,
      current_price: price,
      fundamentals: fundamentalsByTicker.get(holding.ticker) ?? null,
    })
    if (alert) scored.push(alert)
  }

  const ranked = rankAlerts(scored)
  const llmEnabled = isLLMEnabled()

  if (!ranked.length) {
    const response: PortfolioAlertsResponse = {
      alerts: [],
      clear_count: list.length,
      holding_count: list.length,
      generated_at: new Date().toISOString(),
      llm_enabled: llmEnabled,
    }
    return NextResponse.json(response, { headers: NO_CACHE_HEADERS })
  }

  const alertTickers = ranked.map((a) => a.ticker.toUpperCase())
  const cachedByTicker = await loadFreshNarratives<{
    ticker: string
    review_reason: string
    caveat: string
    model: string | null
  }>(supabase, 'portfolio_sell_narratives', alertTickers, LOG_PREFIX)

  const needGeneration = ranked.filter((a) => !cachedByTicker.has(a.ticker.toUpperCase()))

  if (needGeneration.length) {
    console.info(
      `[${LOG_PREFIX}] narratives cache: ${cachedByTicker.size} hit, ${needGeneration.length} miss`,
    )
  }

  type GenResult = {
    ticker: string
    review_reason: string
    caveat: string
    source: 'llm' | 'mechanical'
    model: string | null
  }

  const generated: GenResult[] = await mapSequential(needGeneration, async (alert): Promise<GenResult> => {
      const f = fundamentalsByTicker.get(alert.ticker)
      if (llmEnabled) {
        const narrative = await generateSellReview({
          ticker: alert.ticker,
          company_name: alert.company_name,
          severity: alert.severity,
          position_pnl_pct: alert.holding.position_pnl_pct,
          change_7d_pct: f?.change_7d_pct ?? null,
          change_30d_pct: f?.change_30d_pct ?? null,
          analyst_sell: f?.analyst_sell ?? 0,
          analyst_total:
            (f?.analyst_buy ?? 0) + (f?.analyst_hold ?? 0) + (f?.analyst_sell ?? 0),
          factors: alert.factors.filter((x) => x.tone === 'negative').map((x) => x.label),
        })
        if (narrative) {
          return {
            ticker: alert.ticker,
            review_reason: narrative.review_reason,
            caveat: narrative.caveat,
            source: 'llm',
            model: narrative.model,
          }
        }
      }
      const fallback = mechanicalSellReview(alert)
      return { ticker: alert.ticker, ...fallback, source: 'mechanical', model: null }
  })

  if (generated.length) {
    const narrativeRows = generated.map((g) => ({
      ticker: g.ticker.toUpperCase(),
      review_reason: g.review_reason,
      caveat: g.caveat,
      model: g.source === 'llm' && g.model ? g.model : MECHANICAL_MODEL,
      generated_at: new Date().toISOString(),
    }))
    await upsertNarratives(supabase, 'portfolio_sell_narratives', narrativeRows, LOG_PREFIX)
  }

  const generatedByTicker = new Map<string, GenResult>()
  for (const g of generated) generatedByTicker.set(g.ticker, g)

  const alerts: PortfolioAlert[] = ranked.map((a) => {
    const key = a.ticker.toUpperCase()
    const cached = cachedByTicker.get(key)
    const fresh = generatedByTicker.get(a.ticker)
    const narrative = cached ?? fresh
    return {
      ...a,
      review_reason: narrative?.review_reason ?? null,
      caveat: narrative?.caveat ?? null,
      narrative_source:
        fresh?.source ?? (cached ? narrativeSourceFromModel(cached.model) : 'mechanical'),
    }
  })

  const response: PortfolioAlertsResponse = {
    alerts,
    clear_count: list.length - alerts.length,
    holding_count: list.length,
    generated_at: new Date().toISOString(),
    llm_enabled: llmEnabled,
  }

  return NextResponse.json(response, { headers: NO_CACHE_HEADERS })
}
