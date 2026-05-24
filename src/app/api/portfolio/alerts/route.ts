/**
 * @deprecated Prefer GET /api/portfolio?include=signals — inline signals on holding cards.
 * Kept as a thin alias during migration; does not call Gemini (mechanical narratives only).
 */
import { auth, getSessionUserId } from '@/lib/auth'
import { loadFundamentalsCacheFirst, refreshFundamentalsForTickers } from '@/lib/load-fundamentals'
import { fetchRegularSnapshotsForTickers } from '@/lib/live-prices'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { isLLMEnabled } from '@/lib/llm'
import { mechanicalSignalReview } from '@/lib/portfolio-alerts'
import { rankAlerts, scorePortfolioAlert, type ScoredAlert } from '@/lib/portfolio-alert-scoring'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import type {
  PortfolioAlert,
  PortfolioAlertsResponse,
  PortfolioHolding,
  StockFundamentals,
} from '@/types'

const NO_CACHE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const

export async function GET(req: NextRequest) {
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
  const fundamentalsByTicker = new Map<string, StockFundamentals>()

  const { fundamentals, stale, tableMissing } = await loadFundamentalsCacheFirst(supabase, tickers)
  for (const [ticker, row] of Object.entries(fundamentals)) {
    fundamentalsByTicker.set(ticker.toUpperCase(), row)
  }

  if (forceRefresh && (stale.length || tableMissing)) {
    const refreshed = await refreshFundamentalsForTickers(supabase, stale.length ? stale : tickers, {
      upsert: !tableMissing,
    })
    for (const [ticker, row] of Object.entries(refreshed)) {
      fundamentalsByTicker.set(ticker.toUpperCase(), row)
    }
  }

  const priceMap = await fetchRegularSnapshotsForTickers(tickers)
  const scored: ScoredAlert[] = []

  for (const holding of list) {
    const price = priceMap.get(holding.ticker.toUpperCase())?.price ?? null
    if (price == null) continue
    const alert = scorePortfolioAlert({
      holding,
      current_price: price,
      fundamentals: fundamentalsByTicker.get(holding.ticker.toUpperCase()) ?? null,
    })
    if (alert) scored.push(alert)
  }

  const ranked = rankAlerts(scored)
  const llmEnabled = isLLMEnabled()

  const alerts: PortfolioAlert[] = ranked.map((a) => {
    const tier = a.severity === 'red' ? 'attention' : 'soft'
    const narrative = mechanicalSignalReview(a, tier)
    return {
      ...a,
      review_reason: narrative.review_reason,
      caveat: narrative.caveat,
      narrative_source: 'mechanical' as const,
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
