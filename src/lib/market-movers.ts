// Yahoo Finance predefined screeners — day gainers & most active (no API key).

import { normalizeSector, type WatchlistSector } from '@/lib/sectors'

export interface MoverQuote {
  ticker: string
  company_name: string
  sector: WatchlistSector
  price: number
  change_1d_pct: number
  source: 'gainers' | 'active'
}

async function fetchScreener(scrId: 'day_gainers' | 'most_actives', count: number): Promise<MoverQuote[]> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?scrIds=${scrId}&count=${count}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' },
    )
    if (!res.ok) return []
    const data = await res.json()
    const quotes = data?.finance?.result?.[0]?.quotes ?? []
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
          source: scrId === 'day_gainers' ? 'gainers' as const : 'active' as const,
        }
      })
      .filter(Boolean) as MoverQuote[]
  } catch {
    return []
  }
}

/** Merged unique tickers from today's top gainers + most active. */
export async function fetchMarketMovers(limit = 30): Promise<MoverQuote[]> {
  const [gainers, active] = await Promise.all([
    fetchScreener('day_gainers', limit),
    fetchScreener('most_actives', limit),
  ])
  const seen = new Set<string>()
  const out: MoverQuote[] = []
  for (const q of [...gainers, ...active]) {
    if (seen.has(q.ticker)) continue
    seen.add(q.ticker)
    out.push(q)
  }
  return out
}
