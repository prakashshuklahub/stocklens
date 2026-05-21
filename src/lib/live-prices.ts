export type LivePriceSnapshot = { price: number; change_1d_pct: number }

export async function fetchLivePriceForTicker(ticker: string): Promise<LivePriceSnapshot | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' },
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
  const map = new Map<string, LivePriceSnapshot>()
  if (!tickers.length) return map
  const results = await Promise.all(tickers.map((t) => fetchLivePriceForTicker(t)))
  tickers.forEach((ticker, i) => {
    const r = results[i]
    if (r) map.set(ticker, r)
  })
  return map
}
