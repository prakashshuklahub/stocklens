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

export type YahooCompanyProfile = {
  sector: WatchlistSector | null
  company_name: string | null
}

const profileCache = new Map<string, { profile: YahooCompanyProfile; at: number }>()

// Small, explicit overrides for known Yahoo misclassifications.
// Keep this list tiny and data-driven (only when observed wrong in output).
const SECTOR_OVERRIDES: Partial<Record<string, WatchlistSector>> = {
  IREN: 'Technology',
}

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

async function fetchYahooCompanyProfileUncached(ticker: string): Promise<YahooCompanyProfile> {
  const sym = ticker.toUpperCase()

  // 1) Search endpoint: tends to be reliable for company name and often sector.
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(sym)}&quotesCount=5&newsCount=0`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' },
    )
    if (res.ok) {
      const data = await res.json()
      const match = (data?.quotes ?? []).find(
        (q: { symbol?: string; quoteType?: string }) =>
          q.quoteType === 'EQUITY' && String(q.symbol).toUpperCase() === sym,
      )
      const sector = match?.sector ? normalizeSector(String(match.sector)) : 'Other'
      const name =
        (match?.shortname as string | undefined) ??
        (match?.longname as string | undefined) ??
        null
      if (sector !== 'Other' || name) {
        return { sector: sector !== 'Other' ? sector : null, company_name: name }
      }
    }
  } catch {
    // fall through
  }

  // 2) Asset profile: sector only (no reliable display name).
  const sector = await fetchYahooSectorUncached(sym)
  return { sector, company_name: null }
}

/** Resolve sector + company name from Yahoo (24h in-memory cache). */
export async function fetchYahooCompanyProfile(ticker: string): Promise<YahooCompanyProfile> {
  const key = ticker.toUpperCase()
  const override = SECTOR_OVERRIDES[key]
  const hit = profileCache.get(key)
  if (hit && Date.now() - hit.at < SECTOR_CACHE_TTL_MS) return hit.profile

  const profile = await fetchYahooCompanyProfileUncached(key)
  const finalProfile: YahooCompanyProfile = {
    sector: override ?? profile.sector,
    company_name: profile.company_name,
  }
  profileCache.set(key, { profile: finalProfile, at: Date.now() })

  // Keep the legacy sector-only cache warm too.
  sectorCache.set(key, { sector: finalProfile.sector, at: Date.now() })

  return finalProfile
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
