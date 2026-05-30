import { isUSMarketOpen, type MarketSession } from '@/lib/market-hours'
import { normalizeSector, type WatchlistSector } from '@/lib/sectors'
import type { StockSnapshot } from '@/types'

export type LivePriceSnapshot = {
  price: number
  change_1d_pct: number
  day_high?: number | null
  day_low?: number | null
  session: MarketSession
  as_of?: number | null
  sector?: WatchlistSector | null
}

const YAHOO_UA = 'Mozilla/5.0'
const QUOTE_CHUNK = 50
/** Gap between v7 quote batch requests to reduce Yahoo 429s. */
const QUOTE_CHUNK_GAP_MS = 150
/** Gap between v8 chart fallback requests. */
const CHART_FALLBACK_GAP_MS = 100

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

function quoteSector(q: Record<string, unknown>): WatchlistSector | null {
  const raw =
    (typeof q.sector === 'string' && q.sector) ||
    (typeof q.sectorDisp === 'string' && q.sectorDisp) ||
    null
  return raw ? normalizeSector(raw) : null
}

function dayRangeFromYahoo(q: Record<string, unknown>): {
  day_high: number | null
  day_low: number | null
} {
  const high = q.regularMarketDayHigh
  const low = q.regularMarketDayLow
  return {
    day_high: typeof high === 'number' && high > 0 ? high : null,
    day_low: typeof low === 'number' && low > 0 ? low : null,
  }
}

/** Regular-session price only — last close when market is closed. */
function parseYahooQuote(q: Record<string, unknown>): LivePriceSnapshot | null {
  if (typeof q.regularMarketPrice !== 'number') return null

  const prevClose = previousClose(q)
  const price = q.regularMarketPrice
  const change_1d_pct =
    typeof q.regularMarketChangePercent === 'number'
      ? q.regularMarketChangePercent
      : pctChange(price, prevClose)
  const state = String(q.marketState ?? '').toUpperCase()
  const { day_high, day_low } = dayRangeFromYahoo(q)

  return {
    price,
    change_1d_pct,
    day_high,
    day_low,
    session: state === 'REGULAR' ? 'regular' : 'closed',
    as_of: yahooTimeToMs(q.regularMarketTime),
    sector: quoteSector(q),
  }
}

async function fetchPriceChunk(symbols: string[]): Promise<Map<string, LivePriceSnapshot>> {
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

async function fetchQuoteChunksSequential(
  chunks: string[][],
): Promise<Map<string, LivePriceSnapshot>> {
  const map = new Map<string, LivePriceSnapshot>()
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(QUOTE_CHUNK_GAP_MS)
    const chunkMap = await fetchPriceChunk(chunks[i])
    for (const [sym, snap] of chunkMap) map.set(sym, snap)
  }
  return map
}

async function fetchChartFallbacksSequential(
  syms: string[],
): Promise<Map<string, LivePriceSnapshot>> {
  const map = new Map<string, LivePriceSnapshot>()
  for (let i = 0; i < syms.length; i++) {
    if (i > 0) await sleep(CHART_FALLBACK_GAP_MS)
    const snap = await fetchChartFallback(syms[i])
    if (snap) map.set(syms[i], snap)
  }
  return map
}

async function fetchPricesForTickers(tickers: string[]): Promise<Map<string, LivePriceSnapshot>> {
  const syms = [...new Set(tickers.map((t) => t.toUpperCase()))]
  if (!syms.length) return new Map()

  const chunks: string[][] = []
  for (let i = 0; i < syms.length; i += QUOTE_CHUNK) {
    chunks.push(syms.slice(i, i + QUOTE_CHUNK))
  }

  const map = await fetchQuoteChunksSequential(chunks)

  const missing = syms.filter((sym) => !map.has(sym))
  if (missing.length) {
    const fallbacks = await fetchChartFallbacksSequential(missing)
    for (const [sym, snap] of fallbacks) map.set(sym, snap)
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
    const { day_high, day_low } = dayRangeFromYahoo(meta)

    return {
      price,
      change_1d_pct: pctChange(price, prevClose),
      day_high,
      day_low,
      session: isUSMarketOpen() ? 'regular' : 'closed',
      as_of: yahooTimeToMs(meta.regularMarketTime),
    }
  } catch {
    return null
  }
}

export async function fetchLivePriceForTicker(ticker: string): Promise<LivePriceSnapshot | null> {
  const sym = ticker.toUpperCase()
  const batch = await fetchPriceChunk([sym])
  if (batch.has(sym)) return batch.get(sym)!
  return fetchChartFallback(sym)
}

export async function fetchLivePricesForTickers(
  tickers: string[],
): Promise<Map<string, LivePriceSnapshot>> {
  return fetchPricesForTickers(tickers)
}

export async function fetchRegularPricesForTickers(
  tickers: string[],
): Promise<Map<string, LivePriceSnapshot>> {
  return fetchPricesForTickers(tickers)
}

export function toStockSnapshot(snap: LivePriceSnapshot): StockSnapshot {
  return {
    price: snap.price,
    change_1d_pct: snap.change_1d_pct,
    day_high: snap.day_high ?? null,
    day_low: snap.day_low ?? null,
    session: snap.session,
    is_live: snap.session === 'regular',
    as_of: snap.as_of ?? null,
  }
}

/** Regular-session quotes via Yahoo v7 (last close when market closed). */
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

/** Alias — portfolio and signals use regular close only. */
export async function fetchRegularSnapshotsForTickers(
  tickers: string[],
): Promise<Map<string, StockSnapshot>> {
  return fetchStockSnapshotsForTickers(tickers)
}
