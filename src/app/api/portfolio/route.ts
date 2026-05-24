import { auth, getSessionUserId } from '@/lib/auth'
import { fetchRegularSnapshotsForTickers } from '@/lib/live-prices'
import {
  loadFundamentalsCacheFirst,
  refreshFundamentalsForTickers,
} from '@/lib/load-fundamentals'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
import { attachSignalsToHoldings, buildSignalsMeta } from '@/lib/portfolio-signals'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import type { PortfolioHolding, PortfolioHoldingWithPrice, StockFundamentals } from '@/types'

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })

  const includeSignals = req.nextUrl.searchParams.get('include') === 'signals'
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1' && isPriceRefreshActive()

  const supabase = createServerClient()
  const { data: holdings, error } = await supabase
    .from('portfolio_holdings')
    .select('*')
    .eq('user_id', userId)
    .order('synced_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!holdings?.length) return NextResponse.json(includeSignals ? { holdings: [], meta: null } : [])

  const list = holdings as PortfolioHolding[]
  const tickers = list.map((h) => h.ticker)
  const priceLive = isPriceRefreshActive()
  const prices = await fetchRegularSnapshotsForTickers(tickers)

  void ensureLogosForTickers(supabase, tickers).catch(() => {})

  const cacheHeaders = {
    'X-Market-Open': priceLive ? '1' : '0',
    'Cache-Control': priceLive ? 'private, no-store' : 'private, max-age=3600',
  } as const

  if (!includeSignals) {
    const enriched: PortfolioHoldingWithPrice[] = list.map((h) => ({
      ...h,
      snapshot: prices.get(h.ticker.toUpperCase()) ?? null,
    }))
    return NextResponse.json(enriched, { headers: cacheHeaders })
  }

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

  const withSignals = attachSignalsToHoldings(list, prices, fundamentalsByTicker)
  const meta = buildSignalsMeta(withSignals)

  return NextResponse.json(
    { holdings: withSignals, meta },
    {
      headers: {
        ...cacheHeaders,
        'Cache-Control': 'private, no-store',
      },
    },
  )
}
