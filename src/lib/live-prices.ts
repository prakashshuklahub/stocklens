export type LivePriceSnapshot = { price: number; change_1d_pct: number }

const YAHOO_UA = 'Mozilla/5.0'
/** Yahoo v7 quote supports many symbols per request; chunk to stay safe. */
const QUOTE_CHUNK = 50

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
      const sym = String(q.symbol ?? '').toUpperCase()
      const price = q.regularMarketPrice
      if (!sym || typeof price !== 'number') continue
      const prevClose: number = q.regularMarketPreviousClose ?? q.previousClose ?? price
      const change_1d_pct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0
      map.set(sym, { price, change_1d_pct })
    }
  } catch {
    // fall through — caller may retry per-ticker
  }

  return map
}

export async function fetchLivePriceForTicker(ticker: string): Promise<LivePriceSnapshot | null> {
  const sym = ticker.toUpperCase()
  const batch = await fetchLivePriceChunk([sym])
  if (batch.has(sym)) return batch.get(sym)!

  // Fallback for symbols the batch endpoint skips (e.g. some tickers)
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=1d`,
      { headers: { 'User-Agent': YAHOO_UA }, cache: 'no-store' },
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

  // Retry any misses one-by-one (rare)
  const missing = syms.filter((sym) => !map.has(sym))
  if (missing.length) {
    const fallbacks = await Promise.all(missing.map((sym) => fetchLivePriceForTicker(sym)))
    missing.forEach((sym, i) => {
      const snap = fallbacks[i]
      if (snap) map.set(sym, snap)
    })
  }

  return map
}
