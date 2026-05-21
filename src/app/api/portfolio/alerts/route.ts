import { auth } from '@/lib/auth'
import { fetchStockFundamentals, mapPool } from '@/lib/fundamentals-fetch'
import { generateSellReview, isLLMEnabled } from '@/lib/llm'
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

const NARRATIVE_TTL_HOURS = 6
const NO_CACHE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const

async function fetchOnePrice(ticker: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' },
    )
    if (!res.ok) return null
    const data = await res.json()
    const price = data?.chart?.result?.[0]?.meta?.regularMarketPrice
    return typeof price === 'number' ? price : null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1'
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  const userId = session.user.id

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

  // Always refresh fundamentals on scan so positions get analyst/trend data
  if (forceRefresh || tableMissing || fundamentalsByTicker.size < tickers.length) {
    const toFetch = forceRefresh ? tickers : tickers.filter((t) => !fundamentalsByTicker.has(t))
    const fetched = await mapPool(toFetch, 6, fetchStockFundamentals)
    toFetch.forEach((t, i) => fundamentalsByTicker.set(t, fetched[i]))
    if (!tableMissing && fetched.length) {
      await supabase.from('stock_fundamentals').upsert(
        fetched.map((f) => ({ ...f, fetched_at: new Date().toISOString() })),
        { onConflict: 'ticker' },
      )
    }
  }

  const prices = await Promise.all(tickers.map(fetchOnePrice))
  const scored: ScoredAlert[] = []

  list.forEach((holding, i) => {
    const price = prices[i]
    if (price == null) return
    const alert = scorePortfolioAlert({
      holding,
      current_price: price,
      fundamentals: fundamentalsByTicker.get(holding.ticker) ?? null,
    })
    if (alert) scored.push(alert)
  })

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

  const alertTickers = ranked.map((a) => a.ticker)
  const cachedByTicker = new Map<string, { review_reason: string; caveat: string }>()

  if (!forceRefresh) {
    const ttlCutoff = new Date(Date.now() - NARRATIVE_TTL_HOURS * 3600 * 1000).toISOString()
    const { data: narrativeRows, error: narrativeError } = await supabase
      .from('portfolio_sell_narratives')
      .select('*')
      .in('ticker', alertTickers)
      .gte('generated_at', ttlCutoff)

    if (!narrativeError) {
      for (const r of (narrativeRows ?? []) as Array<{
        ticker: string
        review_reason: string
        caveat: string
      }>) {
        cachedByTicker.set(r.ticker, { review_reason: r.review_reason, caveat: r.caveat })
      }
    }
  }

  const needGeneration = ranked.filter((a) => !cachedByTicker.has(a.ticker))

  type GenResult = {
    ticker: string
    review_reason: string
    caveat: string
    source: 'llm' | 'mechanical'
    model: string | null
  }

  const generated: GenResult[] = await Promise.all(
    needGeneration.map(async (alert): Promise<GenResult> => {
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
    }),
  )

  const llmRows = generated
    .filter((g): g is GenResult & { source: 'llm'; model: string } => g.source === 'llm' && g.model != null)
    .map((g) => ({
      ticker: g.ticker,
      review_reason: g.review_reason,
      caveat: g.caveat,
      model: g.model,
      generated_at: new Date().toISOString(),
    }))

  if (llmRows.length) {
    const { error: upsertError } = await supabase
      .from('portfolio_sell_narratives')
      .upsert(llmRows, { onConflict: 'ticker' })
    if (upsertError) {
      console.warn('[portfolio/alerts] narrative upsert failed:', upsertError.message)
    }
  }

  const generatedByTicker = new Map<string, GenResult>()
  for (const g of generated) generatedByTicker.set(g.ticker, g)

  const alerts: PortfolioAlert[] = ranked.map((a) => {
    const cached = cachedByTicker.get(a.ticker)
    const fresh = generatedByTicker.get(a.ticker)
    const narrative = cached ?? fresh
    return {
      ...a,
      review_reason: narrative?.review_reason ?? null,
      caveat: narrative?.caveat ?? null,
      narrative_source: fresh?.source ?? (cached ? 'llm' : 'mechanical'),
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
