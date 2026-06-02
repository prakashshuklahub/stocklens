/** Yahoo daily close on or before a calendar date (YYYY-MM-DD, US Eastern day). */

export type DailyClosePoint = { t: number; close: number }

const YAHOO_UA = 'Mozilla/5.0'

function etDayStartMs(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  // US Eastern midnight ≈ 05:00 UTC (EST); good enough for picking the trading bar.
  return Date.UTC(y, m - 1, d, 5, 0, 0, 0)
}

/** Last daily close on or before `dateYmd` from a sorted ascending series. */
export function closeOnOrBeforeDate(
  points: DailyClosePoint[],
  dateYmd: string,
): number | null {
  const cutoff = etDayStartMs(dateYmd) + 86400000
  let best: number | null = null
  for (const p of points) {
    if (p.t >= cutoff) break
    best = p.close
  }
  return best
}

export async function fetchYahooDailyCloses(ticker: string): Promise<DailyClosePoint[]> {
  const sym = ticker.toUpperCase()
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1d&range=6mo`,
      { headers: { 'User-Agent': YAHOO_UA }, cache: 'no-store' },
    )
    if (!res.ok) return []

    const data = await res.json()
    const result = data?.chart?.result?.[0]
    if (!result) return []

    const timestamps: number[] = result.timestamp ?? []
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
    const points: DailyClosePoint[] = []

    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i]
      if (typeof close !== 'number' || !Number.isFinite(close)) continue
      points.push({ t: timestamps[i] * 1000, close })
    }

    return points
  } catch {
    return []
  }
}

export function returnPct(fromPrice: number, toPrice: number): number | null {
  if (fromPrice <= 0 || toPrice <= 0) return null
  return ((toPrice - fromPrice) / fromPrice) * 100
}
