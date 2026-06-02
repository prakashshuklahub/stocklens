// Yahoo Finance predefined screeners — seeds stock_fundamentals with curated names.

import { normalizeSector, type WatchlistSector } from '@/lib/sectors'

export type MoverScreenerSlug =
  | 'day_gainers'
  | 'most_actives'
  | 'undervalued_large_caps'
  | 'growth_technology_stocks'
  | 'most_shorted_stocks'

export interface MoverQuote {
  ticker: string
  company_name: string
  sector: WatchlistSector
  price: number
  change_1d_pct: number
  source: 'gainers' | 'active' | 'value' | 'growth' | 'shorted'
}

const SCREENER_SOURCE: Record<MoverScreenerSlug, MoverQuote['source']> = {
  day_gainers: 'gainers',
  most_actives: 'active',
  undervalued_large_caps: 'value',
  growth_technology_stocks: 'growth',
  most_shorted_stocks: 'shorted',
}

/** Max unique tickers merged from all screeners (universe seed cap). */
export const MARKET_MOVERS_POOL_CAP = 100

const DEFAULT_SCREENERS: MoverScreenerSlug[] = [
  'day_gainers',
  'most_actives',
  'undervalued_large_caps',
  'growth_technology_stocks',
  'most_shorted_stocks',
]

async function fetchScreener(scrId: MoverScreenerSlug, count: number): Promise<MoverQuote[]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' },
    )
    if (!res.ok) return []
    const data = await res.json()
    const quotes = data?.finance?.result?.[0]?.quotes ?? []
    const source = SCREENER_SOURCE[scrId]
    return quotes
      .map((q: Record<string, unknown>) => {
        const ticker = String(q.symbol ?? '').toUpperCase()
        const price = Number(q.regularMarketPrice)
        const change = Number(q.regularMarketChangePercent)
        if (!ticker || !/^[A-Z]{1,5}$/.test(ticker) || !Number.isFinite(price) || price < 5) {
          return null
        }
        const rawSector =
          (typeof q.sector === 'string' && q.sector) ||
          (typeof q.sectorDisp === 'string' && q.sectorDisp) ||
          null
        return {
          ticker,
          company_name: String(q.shortName ?? q.longName ?? ticker),
          sector: normalizeSector(rawSector),
          price,
          change_1d_pct: Number.isFinite(change) ? change : 0,
          source,
        }
      })
      .filter(Boolean) as MoverQuote[]
  } catch {
    return []
  }
}

/** Merged unique tickers from Yahoo predefined screeners (capped). */
export async function fetchMarketMovers(
  limitPerScreener = 30,
  poolCap = MARKET_MOVERS_POOL_CAP,
  screeners: MoverScreenerSlug[] = DEFAULT_SCREENERS,
): Promise<MoverQuote[]> {
  const batches = await Promise.all(screeners.map((id) => fetchScreener(id, limitPerScreener)))
  const seen = new Set<string>()
  const out: MoverQuote[] = []
  for (const batch of batches) {
    for (const q of batch) {
      if (seen.has(q.ticker)) continue
      seen.add(q.ticker)
      out.push(q)
      if (out.length >= poolCap) return out
    }
  }
  return out
}
