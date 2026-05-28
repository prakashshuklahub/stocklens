// /api/signals — scored watchlist signals + headlines for watchlist cards.
// Scoring rules: @/lib/signals-scoring

import { auth, getSessionUserId } from '@/lib/auth'
import { fetchRegularSnapshotsForTickers } from '@/lib/live-prices'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { fetchStockFundamentals, mapPool } from '@/lib/fundamentals-fetch'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
import { createServerClient } from '@/lib/supabase'
import { fetchHeadlinesForTickers } from '@/lib/pick-headlines'
import {
  applyFreshNewsBonus,
  computeBaseScore,
  signalBiasFromScore,
  sortSignalsIntoBuckets,
} from '@/lib/signals-scoring'
import { NextResponse } from 'next/server'
import type {
  Signal,
  SignalsResponse,
  StockFundamentals,
  WatchlistStock,
} from '@/types'

export async function GET() {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })

  const supabase = createServerClient()

  const { data: watchlist } = await supabase
    .from('watchlist_stocks')
    .select('*')
    .eq('user_id', userId)

  if (!watchlist?.length) {
    const empty: SignalsResponse = { bullish: [], bearish: [], quiet: [], generated_at: new Date().toISOString() }
    return NextResponse.json(empty)
  }

  const stocks = watchlist as WatchlistStock[]
  const tickers = stocks.map((s) => s.ticker)
  const companyNameByTicker = Object.fromEntries(
    stocks.map((s) => [s.ticker.toUpperCase(), s.company_name]),
  )

  void ensureLogosForTickers(supabase, tickers).catch(() => {})

  const priceLive = isPriceRefreshActive()

  const [priceByTicker, fundamentalsResult, newsByTicker] = await Promise.all([
    fetchRegularSnapshotsForTickers(tickers),
    supabase.from('stock_fundamentals').select('*').in('ticker', tickers),
    fetchHeadlinesForTickers(tickers, { companyNameByTicker }),
  ])

  const fundamentalsByTicker = new Map<string, StockFundamentals>()
  for (const row of (fundamentalsResult.data ?? []) as StockFundamentals[]) {
    fundamentalsByTicker.set(row.ticker, row)
  }

  const tableMissing = Boolean(
    fundamentalsResult.error?.message?.includes('PGRST205') ||
    fundamentalsResult.error?.message?.includes('stock_fundamentals'),
  )
  if (tableMissing || fundamentalsByTicker.size < tickers.length * 0.5) {
    const missing = tickers.filter((t) => !fundamentalsByTicker.has(t))
    const fetched = await mapPool(missing, 6, fetchStockFundamentals)
    missing.forEach((t, i) => fundamentalsByTicker.set(t, fetched[i]))
  }

  const scored = stocks.map((s) => {
    const snap = priceByTicker.get(s.ticker.toUpperCase())
    const priceData = snap
      ? { price: snap.price, change_1d_pct: snap.change_1d_pct }
      : null
    const fundamentals = fundamentalsByTicker.get(s.ticker) ?? null
    const result = computeBaseScore({
      change_1d_pct: priceData?.change_1d_pct ?? null,
      price: priceData?.price ?? null,
      fundamentals,
    })
    return {
      stock: s,
      price: priceData?.price ?? null,
      change_1d_pct: priceData?.change_1d_pct ?? null,
      score: result.score,
      reasons: result.reasons,
    }
  })

  const signals: Signal[] = scored.map((x) => {
    const news = newsByTicker.get(x.stock.ticker.toUpperCase()) ?? []
    const finalScore = applyFreshNewsBonus(x.score, news)
    return {
      ticker: x.stock.ticker,
      company_name: x.stock.company_name,
      sector: x.stock.sector,
      price: x.price,
      change_1d_pct: x.change_1d_pct,
      score: finalScore,
      bias: signalBiasFromScore(finalScore),
      reasons: x.reasons,
      news,
    }
  })

  const { bullish, bearish, quiet } = sortSignalsIntoBuckets(signals)

  const response: SignalsResponse = {
    bullish,
    bearish,
    quiet,
    generated_at: new Date().toISOString(),
  }
  return NextResponse.json(response, {
    headers: {
      'X-Market-Open': priceLive ? '1' : '0',
      'Cache-Control': priceLive ? 'private, no-store' : 'private, max-age=3600',
    },
  })
}
