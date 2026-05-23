// Shared Yahoo + Finnhub + FMP fetch for stock fundamentals.
// Used by /api/fundamentals/[ticker] and /api/picks (live hydration).
//
// Analyst price targets: StockAnalysis → FMP → Finnhub → Yahoo → Eulerpool (fallback chain).
// Cached globally in stock_fundamentals; target_fetched_at resets daily at 5pm IST.

import { env } from '@/lib/env'
import { fetchEulerpoolPriceTarget } from '@/lib/eulerpool-price-target'
import { fetchFmpPriceTarget } from '@/lib/fmp-price-target'
import { fetchStockAnalysisPriceTarget } from '@/lib/stockanalysis-target'
import {
  applyResolvedTarget,
  type TargetFetchResult,
} from '@/lib/target-price-cache'
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
    const volumes: (number | null)[] = result.indicators?.quote?.[0]?.volume ?? []
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

    let volume_ratio: number | null = null
    const todayVol = volumes.length ? volumes[volumes.length - 1] : null
    if (typeof todayVol === 'number' && todayVol > 0 && volumes.length > 21) {
      const prior: number[] = []
      for (let i = volumes.length - 2; i >= 0 && prior.length < 20; i--) {
        const v = volumes[i]
        if (typeof v === 'number' && v > 0) prior.push(v)
      }
      if (prior.length >= 10) {
        const avgVol = prior.reduce((a, b) => a + b, 0) / prior.length
        if (avgVol > 0) volume_ratio = todayVol / avgVol
      }
    }

    return {
      week52_high: (meta?.fiftyTwoWeekHigh as number) ?? null,
      week52_low: (meta?.fiftyTwoWeekLow as number) ?? null,
      change_7d_pct: changePct(7),
      change_14d_pct: changePct(14),
      change_30d_pct: changePct(30),
      support_5d,
      support_20d,
      avg_20d,
      volume_ratio,
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
  const sym = ticker.toUpperCase()
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/price-target?symbol=${sym}&token=${env.FINNHUB_API_KEY}`,
      { cache: 'no-store' }
    )
    if (!res.ok) {
      console.warn(`[price-target] ${sym}: finnhub http=${res.status}`)
      return null
    }
    const data = await res.json()
    if (data?.error) {
      console.warn(`[price-target] ${sym}: finnhub error=${JSON.stringify(data.error)}`)
      return null
    }
    const target_mean = (data.targetMean as number) ?? null
    if (target_mean == null || target_mean <= 0) {
      console.warn(`[price-target] ${sym}: finnhub empty`)
      return null
    }
    return {
      target_mean,
      target_high: (data.targetHigh as number) ?? null,
      target_low: (data.targetLow as number) ?? null,
    }
  } catch (err) {
    console.warn(`[price-target] ${sym}: finnhub error`, err instanceof Error ? err.message : err)
    return null
  }
}

/** StockAnalysis → FMP → Finnhub → Yahoo → Eulerpool with diagnostic logging. */
export async function fetchAnalystPriceTarget(ticker: string): Promise<TargetFetchResult | null> {
  const sym = ticker.toUpperCase()

  const stockanalysis = await fetchStockAnalysisPriceTarget(sym)
  if (stockanalysis?.target_mean) {
    console.info(`[price-target] ${sym}: source=stockanalysis mean=${stockanalysis.target_mean.toFixed(2)}`)
    return { ...stockanalysis, source: 'stockanalysis' }
  }

  if (env.FMP_API_KEY) {
    const fmp = await fetchFmpPriceTarget(sym)
    if (fmp?.target_mean) {
      console.info(`[price-target] ${sym}: source=fmp mean=${fmp.target_mean.toFixed(2)}`)
      return { ...fmp, source: 'fmp' }
    }
  }

  if (env.EULERPOOL_API_KEY) {
    const euler = await fetchEulerpoolPriceTarget(sym)
    if (euler?.target_mean) {
      console.info(`[price-target] ${sym}: source=eulerpool mean=${euler.target_mean.toFixed(2)}`)
      return { ...euler, source: 'eulerpool' }
    }
  }

  const finnhub = await fetchFinnhubPriceTarget(sym)
  if (finnhub?.target_mean) {
    console.info(`[price-target] ${sym}: source=finnhub mean=${finnhub.target_mean.toFixed(2)}`)
    return { ...finnhub, source: 'finnhub' }
  }

  const yahoo = await fetchYahooPriceTarget(sym)
  if (yahoo?.target_mean) {
    console.info(`[price-target] ${sym}: source=yahoo mean=${yahoo.target_mean.toFixed(2)}`)
    return { ...yahoo, source: 'yahoo' }
  }

  console.warn(`[price-target] ${sym}: all sources failed`)
  return null
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

/** Live price / trend data only (no target price API calls). */
export async function fetchStockPriceData(ticker: string): Promise<Omit<
  StockFundamentals,
  'target_mean' | 'target_high' | 'target_low' | 'target_price' | 'target_source' | 'target_fetched_at'
>> {
  const sym = ticker.toUpperCase()
  const [yahoo, recommendation, newsSentiment] = await Promise.all([
    fetchYahooHistory(sym),
    fetchFinnhubRecommendation(sym),
    fetchFinnhubNewsSentiment(sym),
  ])

  return {
    ticker: sym,
    change_7d_pct: yahoo?.change_7d_pct ?? null,
    change_14d_pct: yahoo?.change_14d_pct ?? null,
    change_30d_pct: yahoo?.change_30d_pct ?? null,
    week52_high: yahoo?.week52_high ?? null,
    week52_low: yahoo?.week52_low ?? null,
    analyst_buy: recommendation?.analyst_buy ?? null,
    analyst_hold: recommendation?.analyst_hold ?? null,
    analyst_sell: recommendation?.analyst_sell ?? null,
    news_sentiment: newsSentiment?.news_sentiment ?? null,
    news_count_7d: newsSentiment?.news_count_7d ?? null,
    support_5d: yahoo?.support_5d ?? null,
    support_20d: yahoo?.support_20d ?? null,
    avg_20d: yahoo?.avg_20d ?? null,
    volume_ratio: yahoo?.volume_ratio ?? null,
  }
}

/** Fetch target via FMP/Eulerpool/Finnhub/Yahoo and apply 52W override using week52_high. */
export async function fetchAndResolveTarget(
  ticker: string,
  week52High: number | null,
): Promise<Pick<StockFundamentals, 'target_mean' | 'target_high' | 'target_low' | 'target_price' | 'target_source' | 'target_fetched_at'>> {
  const sym = ticker.toUpperCase()
  const fetchedAt = new Date().toISOString()
  const base: StockFundamentals = {
    ticker: sym,
    change_7d_pct: null,
    change_14d_pct: null,
    change_30d_pct: null,
    week52_high: week52High,
    week52_low: null,
    target_mean: null,
    target_high: null,
    target_low: null,
    target_price: null,
    target_source: null,
    target_fetched_at: null,
    analyst_buy: null,
    analyst_hold: null,
    analyst_sell: null,
    news_sentiment: null,
    news_count_7d: null,
    support_5d: null,
    support_20d: null,
    avg_20d: null,
    volume_ratio: null,
  }

  const analyst = await fetchAnalystPriceTarget(sym)
  const resolved = applyResolvedTarget(base, analyst, fetchedAt)

  if (resolved.target_source === '52w_high') {
    console.info(`[price-target] ${sym}: override=52w_high price=${resolved.target_price?.toFixed(2)}`)
  }

  return {
    target_mean: resolved.target_mean,
    target_high: resolved.target_high,
    target_low: resolved.target_low,
    target_price: resolved.target_price,
    target_source: resolved.target_source,
    target_fetched_at: resolved.target_fetched_at,
  }
}

/** Fetch fresh fundamentals from Yahoo + Finnhub + FMP (no DB). */
export async function fetchStockFundamentals(ticker: string): Promise<StockFundamentals> {
  const sym = ticker.toUpperCase()
  const priceData = await fetchStockPriceData(sym)
  const priceRow: StockFundamentals = {
    ...priceData,
    target_mean: null,
    target_high: null,
    target_low: null,
    target_price: null,
    target_source: null,
    target_fetched_at: null,
  }

  const analyst = await fetchAnalystPriceTarget(sym)
  return applyResolvedTarget(priceRow, analyst, new Date().toISOString())
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
