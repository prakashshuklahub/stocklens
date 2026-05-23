import type { MarketSession } from '@/lib/market-hours'
import { getUSMarketSession } from '@/lib/market-hours'
import { normalizeSector, type WatchlistSector } from '@/lib/sectors'
import type { StockSnapshot } from '@/types'

export type LivePriceSnapshot = {
  price: number
  change_1d_pct: number
  session: MarketSession
  as_of?: number | null
  sector?: WatchlistSector | null
}

const YAHOO_UA = 'Mozilla/5.0'
const QUOTE_CHUNK = 50

function yahooTimeToMs(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  return raw > 1e12 ? raw : raw * 1000
}

function pctChange(price: number, base: number | null | undefined): number {
  if (base == null || base <= 0) return 0
  return ((price - base) / base) * 100
}

function previousClose(q: Record<string, unknown>): number | undefined {
  const base = (q.regularMarketPreviousClose ?? q.previousClose) as number | undefined
  return typeof base === 'number' && base > 0 ? base : undefined
}

/** Yahoo uses PRE / PREPRE for pre-market. */
function isPreMarketState(state: string): boolean {
  return state === 'PRE' || state === 'PREPRE'
}

/** Yahoo uses POST / POSTPOST for after-hours. */
function isPostMarketState(state: string): boolean {
  return state === 'POST' || state === 'POSTPOST'
}

function extendedPrePrice(q: Record<string, unknown>): number | null {
  if (typeof q.preMarketPrice === 'number') return q.preMarketPrice
  if (typeof q.extendedMarketPrice === 'number') return q.extendedMarketPrice
  return null
}

function extendedPostPrice(q: Record<string, unknown>): number | null {
  if (typeof q.postMarketPrice === 'number') return q.postMarketPrice
  if (typeof q.extendedMarketPrice === 'number') return q.extendedMarketPrice
  return null
}

/** v7 quote: skip extended session when Yahoo marks the symbol ineligible. */
function isExtendedQuoteEligible(q: Record<string, unknown>): boolean {
  return q.hasPrePostMarketData !== false
}

function quoteSector(q: Record<string, unknown>): WatchlistSector | null {
  const raw =
    (typeof q.sector === 'string' && q.sector) ||
    (typeof q.sectorDisp === 'string' && q.sectorDisp) ||
    null
  return raw ? normalizeSector(raw) : null
}

function parseYahooQuote(q: Record<string, unknown>): LivePriceSnapshot | null {
  const sym = String(q.symbol ?? '').toUpperCase()
  if (!sym) return null

  const sector = quoteSector(q)

  const state = String(q.marketState ?? '').toUpperCase()
  const prevClose = previousClose(q)

  if (isPreMarketState(state) && isExtendedQuoteEligible(q)) {
    const price = extendedPrePrice(q)
    if (price != null) {
      const change_1d_pct =
        typeof q.preMarketChangePercent === 'number'
          ? q.preMarketChangePercent
          : pctChange(price, prevClose)
      return {
        price,
        change_1d_pct,
        session: 'pre',
        as_of: yahooTimeToMs(q.preMarketTime ?? q.extendedMarketTime),
        sector,
      }
    }
  }

  if (isPostMarketState(state) && isExtendedQuoteEligible(q)) {
    const price = extendedPostPrice(q)
    if (price != null) {
      // Yahoo postMarketChangePercent is vs today's regular close, not previous close.
      const change_1d_pct = pctChange(price, prevClose)
      return {
        price,
        change_1d_pct,
        session: 'post',
        as_of: yahooTimeToMs(q.postMarketTime ?? q.extendedMarketTime),
        sector,
      }
    }
  }

  if (typeof q.regularMarketPrice !== 'number') return null

  const price = q.regularMarketPrice
  const change_1d_pct =
    typeof q.regularMarketChangePercent === 'number'
      ? q.regularMarketChangePercent
      : pctChange(price, prevClose)

  if (state === 'REGULAR') {
    return {
      price,
      change_1d_pct,
      session: 'regular',
      as_of: yahooTimeToMs(q.regularMarketTime),
      sector,
    }
  }

  // PRE/POST with no extended quote (hasPrePostMarketData=false or missing prices):
  // Yahoo only provides regularMarketPrice — show last regular close, not a fake extended badge.
  return {
    price,
    change_1d_pct,
    session: 'closed',
    as_of: yahooTimeToMs(q.regularMarketTime),
    sector,
  }
}

/** Regular-session price only — for portfolio P&L and signals (no pre/post extended prices). */
function parseYahooQuoteRegularOnly(q: Record<string, unknown>): LivePriceSnapshot | null {
  if (typeof q.regularMarketPrice !== 'number') return null

  const prevClose = previousClose(q)
  const price = q.regularMarketPrice
  const change_1d_pct =
    typeof q.regularMarketChangePercent === 'number'
      ? q.regularMarketChangePercent
      : pctChange(price, prevClose)
  const state = String(q.marketState ?? '').toUpperCase()

  return {
    price,
    change_1d_pct,
    session: state === 'REGULAR' ? 'regular' : 'closed',
    as_of: yahooTimeToMs(q.regularMarketTime),
  }
}

async function fetchLivePriceChunk(symbols: string[]): Promise<Map<string, LivePriceSnapshot>> {
  const map = new Map<string, LivePriceSnapshot>()
  if (!symbols.length) return map

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`
    const res = await fetch(url, {
      headers: { 'User-Agent': YAHOO_UA },
      cache: 'no-store',
    })
    if (!res.ok) return map

    const data = await res.json()
    for (const q of data?.quoteResponse?.result ?? []) {
      const snap = parseYahooQuote(q as Record<string, unknown>)
      if (snap) map.set(String(q.symbol).toUpperCase(), snap)
    }
  } catch {
    // fall through — caller may retry per-ticker
  }

  return map
}

async function fetchRegularPriceChunk(symbols: string[]): Promise<Map<string, LivePriceSnapshot>> {
  const map = new Map<string, LivePriceSnapshot>()
  if (!symbols.length) return map

  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`
    const res = await fetch(url, {
      headers: { 'User-Agent': YAHOO_UA },
      cache: 'no-store',
    })
    if (!res.ok) return map

    const data = await res.json()
    for (const q of data?.quoteResponse?.result ?? []) {
      const snap = parseYahooQuoteRegularOnly(q as Record<string, unknown>)
      if (snap) map.set(String(q.symbol).toUpperCase(), snap)
    }
  } catch {
    // fall through
  }

  return map
}

async function fetchRegularPricesForTickers(
  tickers: string[],
): Promise<Map<string, LivePriceSnapshot>> {
  const syms = [...new Set(tickers.map((t) => t.toUpperCase()))]
  const map = new Map<string, LivePriceSnapshot>()
  if (!syms.length) return map

  const chunks: string[][] = []
  for (let i = 0; i < syms.length; i += QUOTE_CHUNK) {
    chunks.push(syms.slice(i, i + QUOTE_CHUNK))
  }

  const chunkResults = await Promise.all(chunks.map((chunk) => fetchRegularPriceChunk(chunk)))
  for (const chunkMap of chunkResults) {
    for (const [sym, snap] of chunkMap) map.set(sym, snap)
  }

  const missing = syms.filter((sym) => !map.has(sym))
  if (missing.length) {
    const fallbacks = await Promise.all(missing.map((sym) => fetchChartFallback(sym)))
    missing.forEach((sym, i) => {
      const snap = fallbacks[i]
      if (snap) map.set(sym, snap)
    })
  }

  return map
}

async function fetchChartFallback(sym: string): Promise<LivePriceSnapshot | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`,
      { headers: { 'User-Agent': YAHOO_UA }, cache: 'no-store' },
    )
    if (!res.ok) return null
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta as Record<string, unknown> | undefined
    if (!meta || typeof meta.regularMarketPrice !== 'number') return null

    const price = meta.regularMarketPrice
    const prevClose = (meta.chartPreviousClose ?? meta.previousClose) as number | undefined
    const clockSession = getUSMarketSession()

    return {
      price,
      change_1d_pct: pctChange(price, prevClose),
      // v8 chart meta only exposes regularMarketPrice (no pre/post price fields).
      session: clockSession === 'regular' ? 'regular' : 'closed',
      as_of: yahooTimeToMs(meta.regularMarketTime),
    }
  } catch {
    return null
  }
}

export async function fetchLivePriceForTicker(ticker: string): Promise<LivePriceSnapshot | null> {
  const sym = ticker.toUpperCase()
  const batch = await fetchLivePriceChunk([sym])
  if (batch.has(sym)) return batch.get(sym)!
  return fetchChartFallback(sym)
}

export async function fetchLivePricesForTickers(
  tickers: string[],
): Promise<Map<string, LivePriceSnapshot>> {
  const syms = [...new Set(tickers.map((t) => t.toUpperCase()))]
  const map = new Map<string, LivePriceSnapshot>()
  if (!syms.length) return map

  const chunks: string[][] = []
  for (let i = 0; i < syms.length; i += QUOTE_CHUNK) {
    chunks.push(syms.slice(i, i + QUOTE_CHUNK))
  }

  const chunkResults = await Promise.all(chunks.map((chunk) => fetchLivePriceChunk(chunk)))
  for (const chunkMap of chunkResults) {
    for (const [sym, snap] of chunkMap) map.set(sym, snap)
  }

  const missing = syms.filter((sym) => !map.has(sym))
  if (missing.length) {
    const fallbacks = await Promise.all(missing.map((sym) => fetchChartFallback(sym)))
    missing.forEach((sym, i) => {
      const snap = fallbacks[i]
      if (snap) map.set(sym, snap)
    })
  }

  return map
}

export function toStockSnapshot(snap: LivePriceSnapshot): StockSnapshot {
  return {
    price: snap.price,
    change_1d_pct: snap.change_1d_pct,
    session: snap.session,
    is_live: snap.session !== 'closed',
    as_of: snap.as_of ?? null,
  }
}

/** Fetch price for current session (pre / regular / post / close) via Yahoo v7 quote. */
export async function fetchStockSnapshotsForTickers(
  tickers: string[],
): Promise<Map<string, StockSnapshot>> {
  const raw = await fetchLivePricesForTickers(tickers)
  const map = new Map<string, StockSnapshot>()
  for (const [sym, snap] of raw) {
    map.set(sym, toStockSnapshot(snap))
  }
  return map
}

/** Regular close + day % only — portfolio holdings and signals scoring. */
export async function fetchRegularSnapshotsForTickers(
  tickers: string[],
): Promise<Map<string, StockSnapshot>> {
  const raw = await fetchRegularPricesForTickers(tickers)
  const map = new Map<string, StockSnapshot>()
  for (const [sym, snap] of raw) {
    map.set(sym, toStockSnapshot(snap))
  }
  return map
}
