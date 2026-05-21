// /api/signals — produces a ranked, scored list of "important" stocks from the
// user's watchlist. Used by the News (Signals) page.
//
// Score sources:
//   1. Live price + 1d change (Yahoo)
//   2. Cached fundamentals (52W, analyst data, target, news sentiment)
//   3. Google News RSS headlines (fetched only for top candidates, for context)

import { auth, getSessionUserId } from '@/lib/auth'
import { fetchStockFundamentals, mapPool } from '@/lib/fundamentals-fetch'
import { createServerClient } from '@/lib/supabase'
import { fetchNewsForTicker } from '@/lib/news'
import { NextResponse } from 'next/server'
import type {
  Signal,
  SignalReason,
  SignalNewsItem,
  SignalsResponse,
  StockFundamentals,
  WatchlistStock,
} from '@/types'

// ── Yahoo live price ──────────────────────────────────────────────────────────
async function fetchOnePrice(ticker: string) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }
    )
    if (!res.ok) return null
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    if (!meta?.regularMarketPrice) return null
    const price: number = meta.regularMarketPrice
    const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price
    const change_1d_pct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0
    return { price, change_1d_pct }
  } catch {
    return null
  }
}

// ── Scoring rules ─────────────────────────────────────────────────────────────
// Each rule returns a reason if it fires. The score is signed:
//   positive = bullish, negative = bearish.
// We then bucket by |score| > BIAS_THRESHOLD.

const BIAS_THRESHOLD = 20

interface ScoreInput {
  change_1d_pct: number | null
  price: number | null
  fundamentals: StockFundamentals | null
}

function score(input: ScoreInput): { score: number; reasons: SignalReason[] } {
  const reasons: SignalReason[] = []
  let s = 0
  const f = input.fundamentals
  const price = input.price
  const d1 = input.change_1d_pct

  // ── 1d move ────────────────────────────────────────────────
  if (d1 != null && Math.abs(d1) > 5) {
    const points = 25
    if (d1 > 0) { s += points; reasons.push({ label: `+${d1.toFixed(1)}% today`, tone: 'bullish' }) }
    else        { s -= points; reasons.push({ label: `${d1.toFixed(1)}% today`,  tone: 'bearish' }) }
  }

  // ── 52W extremes ───────────────────────────────────────────
  if (f?.week52_high && f?.week52_low && price) {
    const fromHigh = ((f.week52_high - price) / f.week52_high) * 100
    const fromLow  = ((price - f.week52_low) / f.week52_low) * 100
    if (fromHigh <= 3) { s += 20; reasons.push({ label: 'Near 52W high', tone: 'bullish' }) }
    else if (fromLow <= 5) { s -= 20; reasons.push({ label: 'Near 52W low', tone: 'bearish' }) }
  }

  // ── Analyst price target ───────────────────────────────────
  if (f?.target_mean && price) {
    const upside = ((f.target_mean - price) / price) * 100
    if (upside > 20)      { s += 15; reasons.push({ label: `+${upside.toFixed(0)}% to target`, tone: 'bullish' }) }
    else if (upside < -10) { s -= 15; reasons.push({ label: `${upside.toFixed(0)}% to target`, tone: 'bearish' }) }
  }

  // ── Analyst recommendation consensus ──────────────────────
  const buy = f?.analyst_buy ?? 0
  const hold = f?.analyst_hold ?? 0
  const sell = f?.analyst_sell ?? 0
  const total = buy + hold + sell
  if (total >= 5) {
    const buyRatio = buy / total
    const sellRatio = sell / total
    if (buyRatio > 0.7)      { s += 10; reasons.push({ label: 'Strong buy', tone: 'bullish' }) }
    else if (sellRatio > 0.3) { s -= 15; reasons.push({ label: 'Sell consensus', tone: 'bearish' }) }
  }

  // ── 30d trend ──────────────────────────────────────────────
  if (f?.change_30d_pct != null && Math.abs(f.change_30d_pct) > 15) {
    if (f.change_30d_pct > 0) { s += 10; reasons.push({ label: `+${f.change_30d_pct.toFixed(0)}% in 30d`, tone: 'bullish' }) }
    else                       { s -= 10; reasons.push({ label: `${f.change_30d_pct.toFixed(0)}% in 30d`, tone: 'bearish' }) }
  }

  // ── Finnhub news sentiment ────────────────────────────────
  if (f?.news_sentiment != null) {
    if (f.news_sentiment > 0.5)      { s += 15; reasons.push({ label: 'Positive news', tone: 'bullish' }) }
    else if (f.news_sentiment < -0.3) { s -= 15; reasons.push({ label: 'Negative news', tone: 'bearish' }) }
  }

  return { score: s, reasons }
}

// ── Route handler ─────────────────────────────────────────────────────────────
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

  // Fetch live prices + cached fundamentals in parallel.
  const [priceResults, fundamentalsResult] = await Promise.all([
    Promise.all(tickers.map(fetchOnePrice)),
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

  // Initial scoring (no news yet).
  const scored = stocks.map((s, i) => {
    const priceData = priceResults[i]
    const fundamentals = fundamentalsByTicker.get(s.ticker) ?? null
    const result = score({
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

  // Fetch news only for stocks that already qualify (top movers).
  // This keeps the route bounded (max ~30 RSS requests instead of 46+).
  const newsTargets = scored
    .filter((x) => Math.abs(x.score) >= BIAS_THRESHOLD)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, 30)
    .map((x) => x.stock.ticker)

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
        }))
      )
    })
  }

  // Final signals.
  const signals: Signal[] = scored.map((x) => {
    const news = newsByTicker.get(x.stock.ticker) ?? []
    // Small bonus if there's fresh news in the last 48h.
    const fresh = news.find((n) => Date.now() - new Date(n.published_at).getTime() < 48 * 3600 * 1000)
    const finalScore = x.score + (fresh ? (x.score >= 0 ? 5 : -5) : 0)
    const bias: Signal['bias'] =
      finalScore > BIAS_THRESHOLD ? 'bullish' :
      finalScore < -BIAS_THRESHOLD ? 'bearish' : 'quiet'

    return {
      ticker: x.stock.ticker,
      company_name: x.stock.company_name,
      sector: x.stock.sector,
      price: x.price,
      change_1d_pct: x.change_1d_pct,
      score: finalScore,
      bias,
      reasons: x.reasons,
      news,
    }
  })

  const sortDesc = (a: Signal, b: Signal) => Math.abs(b.score) - Math.abs(a.score)
  const bullish = signals.filter((s) => s.bias === 'bullish').sort(sortDesc)
  const bearish = signals.filter((s) => s.bias === 'bearish').sort(sortDesc)
  const quiet   = signals.filter((s) => s.bias === 'quiet').sort((a, b) =>
    Math.abs(b.change_1d_pct ?? 0) - Math.abs(a.change_1d_pct ?? 0)
  )

  const response: SignalsResponse = {
    bullish,
    bearish,
    quiet,
    generated_at: new Date().toISOString(),
  }
  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'private, max-age=60' },
  })
}
