// Shared Yahoo + Finnhub fetch for stock fundamentals.
// Used by /api/fundamentals/[ticker] and /api/picks (live hydration).
//
// Analyst price targets: Finnhub /stock/price-target when subscribed; otherwise
// Yahoo quoteSummary financialData (free).

import { env } from '@/lib/env'
import { fetchYahooPriceTarget, type PriceTargetFields } from '@/lib/yahoo-session'
import type { StockFundamentals } from '@/types'

export async function fetchYahooHistory(ticker: string) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1y`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }
    )
    if (!res.ok) return null
    const data = await res.json()
    const result = data?.chart?.result?.[0]
    if (!result) return null

    const meta = result.meta
    const timestamps: number[] = result.timestamp ?? []
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
    const currentPrice: number | null = meta?.regularMarketPrice ?? null

    function changePct(daysAgo: number): number | null {
      if (!currentPrice || closes.length < 2) return null
      const cutoff = Date.now() / 1000 - daysAgo * 86400
      let idx = -1
      for (let i = timestamps.length - 1; i >= 0; i--) {
        if (timestamps[i] <= cutoff) { idx = i; break }
      }
      if (idx < 0 || closes[idx] == null) return null
      return ((currentPrice - closes[idx]!) / closes[idx]!) * 100
    }

    const last5: number[] = []
    const last20: number[] = []
    for (let i = closes.length - 1; i >= 0 && (last5.length < 5 || last20.length < 20); i--) {
      const c = closes[i]
      if (typeof c !== 'number') continue
      if (last5.length < 5) last5.push(c)
      if (last20.length < 20) last20.push(c)
    }
    const support_5d = last5.length ? Math.min(...last5) : null
    const support_20d = last20.length ? Math.min(...last20) : null
    const avg_20d = last20.length ? last20.reduce((a, b) => a + b, 0) / last20.length : null

    return {
      week52_high: (meta?.fiftyTwoWeekHigh as number) ?? null,
      week52_low: (meta?.fiftyTwoWeekLow as number) ?? null,
      change_7d_pct: changePct(7),
      change_14d_pct: changePct(14),
      change_30d_pct: changePct(30),
      support_5d,
      support_20d,
      avg_20d,
    }
  } catch {
    return null
  }
}

export async function fetchFinnhubRecommendation(ticker: string) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${env.FINNHUB_API_KEY}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!Array.isArray(data) || !data.length) return null
    const latest = data[0]
    return {
      analyst_buy: (latest.strongBuy ?? 0) + (latest.buy ?? 0),
      analyst_hold: latest.hold ?? 0,
      analyst_sell: (latest.strongSell ?? 0) + (latest.sell ?? 0),
    }
  } catch {
    return null
  }
}

export async function fetchFinnhubPriceTarget(ticker: string): Promise<PriceTargetFields | null> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/price-target?symbol=${ticker}&token=${env.FINNHUB_API_KEY}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (data?.error) return null
    const target_mean = (data.targetMean as number) ?? null
    if (target_mean == null || target_mean <= 0) return null
    return {
      target_mean,
      target_high: (data.targetHigh as number) ?? null,
      target_low: (data.targetLow as number) ?? null,
    }
  } catch {
    return null
  }
}

/** Prefer Finnhub when available; otherwise Yahoo analyst consensus. */
export function mergePriceTargets(
  finnhub: PriceTargetFields | null,
  yahoo: PriceTargetFields | null,
): PriceTargetFields | null {
  if (finnhub?.target_mean && finnhub.target_mean > 0) return finnhub
  if (yahoo?.target_mean && yahoo.target_mean > 0) return yahoo
  return null
}

export async function fetchAnalystPriceTarget(ticker: string): Promise<PriceTargetFields | null> {
  const finnhub = await fetchFinnhubPriceTarget(ticker)
  if (finnhub?.target_mean) return finnhub
  const yahoo = await fetchYahooPriceTarget(ticker)
  return mergePriceTargets(finnhub, yahoo)
}

export async function fetchFinnhubNewsSentiment(ticker: string) {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/news-sentiment?symbol=${ticker}&token=${env.FINNHUB_API_KEY}`,
      { cache: 'no-store' }
    )
    if (!res.ok) return null
    const data = await res.json()
    const score = data?.companyNewsScore
    const weekly = data?.buzz?.weeklyAverage ?? data?.buzz?.articlesInLastWeek
    return {
      news_sentiment: typeof score === 'number' ? score : null,
      news_count_7d: typeof weekly === 'number' ? Math.round(weekly) : null,
    }
  } catch {
    return null
  }
}

/** Fetch fresh fundamentals from Yahoo + Finnhub (no DB). */
export async function fetchStockFundamentals(ticker: string): Promise<StockFundamentals> {
  const sym = ticker.toUpperCase()
  const [yahoo, recommendation, priceTarget, newsSentiment] = await Promise.all([
    fetchYahooHistory(sym),
    fetchFinnhubRecommendation(sym),
    fetchAnalystPriceTarget(sym),
    fetchFinnhubNewsSentiment(sym),
  ])

  return {
    ticker: sym,
    change_7d_pct: yahoo?.change_7d_pct ?? null,
    change_14d_pct: yahoo?.change_14d_pct ?? null,
    change_30d_pct: yahoo?.change_30d_pct ?? null,
    week52_high: yahoo?.week52_high ?? null,
    week52_low: yahoo?.week52_low ?? null,
    target_mean: priceTarget?.target_mean ?? null,
    target_high: priceTarget?.target_high ?? null,
    target_low: priceTarget?.target_low ?? null,
    analyst_buy: recommendation?.analyst_buy ?? null,
    analyst_hold: recommendation?.analyst_hold ?? null,
    analyst_sell: recommendation?.analyst_sell ?? null,
    news_sentiment: newsSentiment?.news_sentiment ?? null,
    news_count_7d: newsSentiment?.news_count_7d ?? null,
    support_5d: yahoo?.support_5d ?? null,
    support_20d: yahoo?.support_20d ?? null,
    avg_20d: yahoo?.avg_20d ?? null,
  }
}

/** Run async tasks with limited concurrency. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let i = 0
  async function worker() {
    while (i < items.length) {
      const idx = i++
      results[idx] = await fn(items[idx])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return results
}
