/** Canonical watchlist sector labels (matches watchlist page SECTOR_ORDER). */

export const WATCHLIST_SECTORS = [
  'Technology',
  'Healthcare',
  'Consumer Discretionary',
  'Consumer Staples',
  'Financials',
  'Industrials',
  'Energy',
  'Real Estate',
  'Communication Services',
  'Materials',
  'Utilities',
  'Other',
] as const

export type WatchlistSector = (typeof WATCHLIST_SECTORS)[number]

/** Yahoo Finance / screener sector strings → watchlist sector. */
const SECTOR_MAP: Record<string, WatchlistSector> = {
  Technology: 'Technology',
  Healthcare: 'Healthcare',
  'Financial Services': 'Financials',
  Financials: 'Financials',
  'Consumer Cyclical': 'Consumer Discretionary',
  'Consumer Discretionary': 'Consumer Discretionary',
  'Consumer Defensive': 'Consumer Staples',
  'Consumer Staples': 'Consumer Staples',
  Energy: 'Energy',
  Industrials: 'Industrials',
  'Basic Materials': 'Materials',
  Materials: 'Materials',
  Utilities: 'Utilities',
  'Communication Services': 'Communication Services',
  'Real Estate': 'Real Estate',
  'Consumer Goods': 'Consumer Discretionary',
  Services: 'Industrials',
}

export function normalizeSector(raw: string | null | undefined): WatchlistSector {
  const trimmed = raw?.trim()
  if (!trimmed) return 'Other'
  if (SECTOR_MAP[trimmed]) return SECTOR_MAP[trimmed]
  const title = trimmed.replace(/\b\w/g, (c) => c.toUpperCase())
  if (SECTOR_MAP[title]) return SECTOR_MAP[title]
  if ((WATCHLIST_SECTORS as readonly string[]).includes(trimmed)) return trimmed as WatchlistSector
  if ((WATCHLIST_SECTORS as readonly string[]).includes(title)) return title as WatchlistSector
  return 'Other'
}

const SECTOR_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const sectorCache = new Map<string, { sector: WatchlistSector | null; at: number }>()

async function fetchYahooSectorUncached(ticker: string): Promise<WatchlistSector | null> {
  const sym = ticker.toUpperCase()

  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=assetProfile`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' },
    )
    if (res.ok) {
      const data = await res.json()
      const raw = data?.quoteSummary?.result?.[0]?.assetProfile?.sector as string | undefined
      const sector = normalizeSector(raw)
      if (sector !== 'Other') return sector
    }
  } catch {
    /* try search fallback */
  }

  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(sym)}&quotesCount=5&newsCount=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' },
    )
    if (!res.ok) return null
    const data = await res.json()
    const match = (data?.quotes ?? []).find(
      (q: { symbol?: string; quoteType?: string }) =>
        q.quoteType === 'EQUITY' && String(q.symbol).toUpperCase() === sym,
    )
    if (match?.sector) {
      const sector = normalizeSector(String(match.sector))
      if (sector !== 'Other') return sector
    }
  } catch {
    return null
  }

  return null
}

/** Resolve sector from Yahoo when screener/search did not provide one (24h in-memory cache). */
export async function fetchYahooSector(ticker: string): Promise<WatchlistSector | null> {
  const key = ticker.toUpperCase()
  const hit = sectorCache.get(key)
  if (hit && Date.now() - hit.at < SECTOR_CACHE_TTL_MS) return hit.sector

  const sector = await fetchYahooSectorUncached(key)
  sectorCache.set(key, { sector, at: Date.now() })
  return sector
}

export async function resolveSectorForTicker(
  ticker: string,
  hint?: string | null,
): Promise<WatchlistSector> {
  const fromHint = normalizeSector(hint)
  if (fromHint !== 'Other') return fromHint
  const fetched = await fetchYahooSector(ticker)
  return fetched ?? 'Other'
}
