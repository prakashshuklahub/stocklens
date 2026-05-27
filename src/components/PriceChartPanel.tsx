'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { cn } from '@/lib/utils'
import { CHART_RANGE_OPTIONS, type ChartRange, type PriceChartPayload } from '@/lib/yahoo-chart'

function fmtPct(n: number | null | undefined, showPlus = true): string | null {
  if (n == null) return null
  return `${showPlus && n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

export function priceChartCollapsedPreview({
  change1d,
  change7d,
  change30d,
  volumeRatio,
}: {
  change1d?: number | null
  change7d?: number | null
  change30d?: number | null
  volumeRatio?: number | null
}): string {
  const today = fmtPct(change1d)
  const w7 = fmtPct(change7d)
  const w30 = fmtPct(change30d)
  if (volumeRatio != null && volumeRatio >= 1.3) {
    return `Today ${today ?? '—'} · 7d ${w7 ?? '—'} · 30d ${w30 ?? '—'} · ${volumeRatio.toFixed(1)}× volume`
  }
  return `Today ${today ?? '—'} · 7d ${w7 ?? '—'} · 30d ${w30 ?? '—'}`
}

async function fetchChart(url: string): Promise<PriceChartPayload> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Chart fetch failed')
  return res.json()
}

function MiniLineChart({ points, positive }: { points: { close: number }[]; positive: boolean }) {
  const width = 320
  const height = 96
  const padX = 4
  const padY = 6

  if (points.length < 2) {
    return (
      <div className="flex h-24 items-center justify-center type-meta text-zinc-500">
        Not enough data for this range
      </div>
    )
  }

  const closes = points.map((p) => p.close)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const span = max - min || max * 0.01 || 1

  const coords = points.map((p, i) => {
    const x = padX + (i / (points.length - 1)) * (width - padX * 2)
    const y = padY + (1 - (p.close - min) / span) * (height - padY * 2)
    return { x, y }
  })

  const line = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
  const area = `${coords[0].x.toFixed(1)},${height} ${line} ${coords[coords.length - 1].x.toFixed(1)},${height}`
  const stroke = positive ? '#34d399' : '#f87171'
  const fill = positive ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)'

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-24"
      role="img"
      aria-label="Price chart"
      preserveAspectRatio="none"
    >
      <polygon points={area} fill={fill} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

export default function PriceChartPanel({
  ticker,
  volumeRatio,
}: {
  ticker: string
  volumeRatio?: number | null
}) {
  const [range, setRange] = useState<ChartRange>('1d')
  const { data, error, isLoading } = useSWR<PriceChartPayload>(
    `/api/chart/${encodeURIComponent(ticker)}?range=${range}`,
    fetchChart,
    { revalidateOnFocus: false },
  )

  const change = data?.change_pct ?? null
  const positive = change == null ? true : change >= 0

  return (
    <div className="rounded-xl bg-zinc-800/50 px-3 py-2.5 border border-white/[0.04]">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex items-center gap-1 rounded-lg bg-zinc-900/60 p-0.5 border border-white/[0.04] w-max">
            {CHART_RANGE_OPTIONS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setRange(id)}
                className={cn(
                  'px-2 py-1 rounded-md type-meta font-semibold tabular-nums transition-colors shrink-0',
                  range === id
                    ? 'bg-zinc-700 text-zinc-100'
                    : 'text-zinc-500 hover:text-zinc-300',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {change != null && (
          <span
            className={cn(
              'text-sm font-bold tabular-nums',
              positive ? 'text-emerald-400' : 'text-red-400',
            )}
          >
            {fmtPct(change)}
          </span>
        )}
      </div>

      {isLoading && !data && (
        <div className="flex h-24 items-center justify-center type-meta text-zinc-500">
          Loading chart…
        </div>
      )}
      {error && !data && (
        <div className="flex h-24 items-center justify-center type-meta text-zinc-500">
          Chart unavailable right now
        </div>
      )}
      {data && (
        <MiniLineChart points={data.points} positive={positive} />
      )}

      {volumeRatio != null && volumeRatio >= 1.3 && (
        <div className="flex items-center gap-2 type-meta pt-2.5 mt-2.5 border-t border-white/[0.04]">
          <span className="text-zinc-400">
            Volume{' '}
            <span className="text-amber-300 font-semibold tabular-nums">
              {volumeRatio.toFixed(1)}×
            </span>
            {' '}vs 20-day average
          </span>
        </div>
      )}
    </div>
  )
}
