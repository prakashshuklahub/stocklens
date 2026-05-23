// /api/signals — produces a ranked, scored list of "important" stocks from the
// user's watchlist. Used by the News (Signals) page.
//
// Scoring rules live in @/lib/signals-scoring — edit that file to tune logic.

import { auth, getSessionUserId } from '@/lib/auth'
import { fetchRegularSnapshotsForTickers } from '@/lib/live-prices'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { fetchStockFundamentals, mapPool } from '@/lib/fundamentals-fetch'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
import { createServerClient } from '@/lib/supabase'
import { fetchNewsForTicker } from '@/lib/news'
import {
  applyFreshNewsBonus,
  computeBaseScore,
  pickNewsTargetTickers,
  signalBiasFromScore,
  sortSignalsIntoBuckets,
} from '@/lib/signals-scoring'
import { NextResponse } from 'next/server'
import type {
  Signal,
  SignalNewsItem,
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

  void ensureLogosForTickers(supabase, tickers).catch(() => {})

  const priceLive = isPriceRefreshActive()

  const [priceByTicker, fundamentalsResult] = await Promise.all([
    fetchRegularSnapshotsForTickers(tickers),
    supabase.from('stock_fundamentals').select('*').in('ticker', tickers),
  ])

  const fundamentalsByTicker = new Map<string, StockFundamentals>()
  for (const row of (fundamentalsResult.data ?? []) as StockFundamentals[]) {
    fundamentalsByTicker.set(row.ticker, row)
  }

  const tableMissing = Boolean(
    fundamentalsResult.error?.message?.includes('PGRST205') ||
    fundamentalsResult.error?.message?.includes('stock_fundamentals')
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
    const extendedSession =
      snap?.session === 'pre' || snap?.session === 'post' ? snap.session : undefined
    const result = computeBaseScore({
      change_1d_pct: priceData?.change_1d_pct ?? null,
      price: priceData?.price ?? null,
      extendedSession,
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

  const newsTargets = pickNewsTargetTickers(
    scored.map((x) => ({
      ticker: x.stock.ticker,
      score: x.score,
      change_1d_pct: x.change_1d_pct,
    })),
  )

  const newsByTicker = new Map<string, SignalNewsItem[]>()
  if (newsTargets.length) {
    const newsResults = await Promise.all(newsTargets.map(fetchNewsForTicker))
    newsTargets.forEach((ticker, i) => {
      const items = newsResults[i] ?? []
      items.sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
      newsByTicker.set(
        ticker,
        items.slice(0, 5).map((n) => ({
          title: n.title,
          url: n.url,
          source: n.source,
          published_at: n.published_at,
          sentiment: n.sentiment,
        })),
      )
    })
  }

  const signals: Signal[] = scored.map((x) => {
    const news = newsByTicker.get(x.stock.ticker) ?? []
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
