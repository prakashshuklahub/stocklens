/** On-demand Yahoo v8 chart series — not stored in stock_fundamentals. */

export const CHART_RANGE_OPTIONS = [
  { id: '1d', label: '1D', interval: '5m', range: '1d', cacheSeconds: 60 },
  { id: '5d', label: '5D', interval: '15m', range: '5d', cacheSeconds: 300 },
  { id: '1m', label: '1M', interval: '1d', range: '1mo', cacheSeconds: 900 },
  { id: '6m', label: '6M', interval: '1d', range: '6mo', cacheSeconds: 1800 },
  { id: '1y', label: '1Y', interval: '1d', range: '1y', cacheSeconds: 3600 },
  { id: '5y', label: '5Y', interval: '1wk', range: '5y', cacheSeconds: 3600 },
  { id: 'max', label: 'Max', interval: '1mo', range: 'max', cacheSeconds: 3600 },
] as const

export type ChartRange = (typeof CHART_RANGE_OPTIONS)[number]['id']

export type PriceChartPoint = {
  t: number
  close: number
}

export type PriceChartPayload = {
  ticker: string
  range: ChartRange
  points: PriceChartPoint[]
  change_pct: number | null
  currency: string | null
}

const RANGE_BY_ID = Object.fromEntries(
  CHART_RANGE_OPTIONS.map((opt) => [opt.id, opt]),
) as Record<ChartRange, (typeof CHART_RANGE_OPTIONS)[number]>

export function isChartRange(value: string | null): value is ChartRange {
  return value != null && value in RANGE_BY_ID
}

function downsamplePoints(points: PriceChartPoint[], maxPoints = 180): PriceChartPoint[] {
  if (points.length <= maxPoints) return points
  const step = Math.ceil(points.length / maxPoints)
  const out: PriceChartPoint[] = []
  for (let i = 0; i < points.length; i += step) out.push(points[i])
  const last = points[points.length - 1]
  if (out[out.length - 1]?.t !== last.t) out.push(last)
  return out
}

export async function fetchYahooChartSeries(
  ticker: string,
  chartRange: ChartRange,
): Promise<PriceChartPayload | null> {
  const sym = ticker.toUpperCase()
  const { interval, range } = RANGE_BY_ID[chartRange]

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=${interval}&range=${range}`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' },
    )
    if (!res.ok) return null

    const data = await res.json()
    const result = data?.chart?.result?.[0]
    if (!result) return null

    const timestamps: number[] = result.timestamp ?? []
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? []
    const currency: string | null = result.meta?.currency ?? null

    const points: PriceChartPoint[] = []
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i]
      if (typeof close !== 'number' || !Number.isFinite(close)) continue
      points.push({ t: timestamps[i] * 1000, close })
    }

    const sampled = downsamplePoints(points)

    if (sampled.length < 2) {
      return {
        ticker: sym,
        range: chartRange,
        points: sampled,
        change_pct: null,
        currency,
      }
    }

    const first = sampled[0].close
    const last = sampled[sampled.length - 1].close
    const change_pct = first > 0 ? ((last - first) / first) * 100 : null

    return {
      ticker: sym,
      range: chartRange,
      points: sampled,
      change_pct,
      currency,
    }
  } catch {
    return null
  }
}

export function chartRangeCacheSeconds(range: ChartRange): number {
  return RANGE_BY_ID[range].cacheSeconds
}
