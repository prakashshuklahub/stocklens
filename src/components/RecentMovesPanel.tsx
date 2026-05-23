import { BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'

function fmtPct(n: number | null | undefined, showPlus = true): string | null {
  if (n == null) return null
  return `${showPlus && n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function PctBadge({ value, label }: { value: number | null; label: string }) {
  if (value == null) {
    return (
      <div className="flex flex-col items-center gap-1">
        <span className="text-[11px] text-zinc-500">{label}</span>
        <div className="h-3 w-10 rounded bg-zinc-700/60 animate-pulse" />
      </div>
    )
  }
  const isPos = value >= 0
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[11px] text-zinc-500 font-medium">{label}</span>
      <span className={cn('text-sm font-bold tabular-nums', isPos ? 'text-emerald-400' : 'text-red-400')}>
        {fmtPct(value)}
      </span>
    </div>
  )
}

export function recentMovesCollapsedPreview({
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

export default function RecentMovesPanel({
  change7d,
  change14d,
  change30d,
  volumeRatio,
}: {
  change7d: number | null
  change14d: number | null
  change30d: number | null
  volumeRatio?: number | null
}) {
  return (
    <div className="rounded-xl bg-zinc-800/50 px-3 py-2.5 border border-white/[0.04]">
      <div className="flex items-center justify-around">
        <PctBadge value={change7d} label="7d" />
        <div className="w-px h-5 bg-zinc-700/60" />
        <PctBadge value={change14d} label="14d" />
        <div className="w-px h-5 bg-zinc-700/60" />
        <PctBadge value={change30d} label="30d" />
      </div>
      {volumeRatio != null && volumeRatio >= 1.3 && (
        <div className="flex items-center gap-2 text-[11px] pt-2.5 mt-2.5 border-t border-white/[0.04]">
          <BarChart3 className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
          <span className="text-zinc-400">
            Trading volume is{' '}
            <span className="text-amber-300 font-semibold tabular-nums">
              {volumeRatio.toFixed(1)}×
            </span>
            {' '}the usual daily average
          </span>
        </div>
      )}
    </div>
  )
}
