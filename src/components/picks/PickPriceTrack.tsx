'use client'

import { ArrowRight, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import {
  formatPickPrice,
  formatPickPublishedDate,
  formatPickSincePct,
  pickReturnSincePublishPct,
  suggestedPickPrice,
} from '@/lib/target-price-display'
import { cn } from '@/lib/utils'
import type { Pick } from '@/types'

type Props = {
  pick: Pick
  /** ISO time when the published picks run completed. */
  pickedAt?: string | null
  compact?: boolean
}

export default function PickPriceTrack({ pick, pickedAt, compact = false }: Props) {
  const suggested = suggestedPickPrice(pick)
  const now = pick.current_price
  const sincePct = pickReturnSincePublishPct(pick)
  const isUp = sincePct != null && sincePct > 0.05
  const isDown = sincePct != null && sincePct < -0.05
  const dateLabel = pickedAt ? formatPickPublishedDate(pickedAt) : null

  const badgeClass = isUp
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
    : isDown
      ? 'bg-red-500/15 text-red-300 border-red-500/25'
      : 'bg-zinc-800/80 text-zinc-300 border-white/10'

  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus

  return (
    <div
      className={cn(
        'rounded-xl border border-white/[0.06] bg-zinc-950/40',
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5',
      )}
      aria-label={
        sincePct != null
          ? `Since we picked at ${formatPickPrice(suggested)}, now ${formatPickPrice(now)}, ${formatPickSincePct(sincePct)}`
          : `Suggested ${formatPickPrice(suggested)}, now ${formatPickPrice(now)}`
      }
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="type-micro font-bold uppercase tracking-wide text-zinc-500">
          Since we picked
        </span>
        {dateLabel ? (
          <span className="type-meta text-zinc-600 tabular-nums">{dateLabel}</span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <div className="min-w-0">
            <p className="type-meta text-zinc-600 leading-none mb-0.5">Then</p>
            <p className="text-sm font-bold text-zinc-400 tabular-nums leading-tight">
              {formatPickPrice(suggested)}
            </p>
          </div>
          <ArrowRight className="w-4 h-4 shrink-0 text-zinc-600" aria-hidden="true" />
          <div className="min-w-0">
            <p className="type-meta text-zinc-600 leading-none mb-0.5">Now</p>
            <p className="text-sm font-bold text-white tabular-nums leading-tight">
              {formatPickPrice(now)}
            </p>
          </div>
        </div>

        {sincePct != null ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 shrink-0 rounded-lg border px-2.5 py-1.5 min-h-[36px]',
              'text-sm font-black tabular-nums [touch-action:manipulation]',
              badgeClass,
            )}
          >
            <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            {formatPickSincePct(sincePct)}
          </span>
        ) : null}
      </div>
    </div>
  )
}
