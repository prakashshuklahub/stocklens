'use client'

import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import {
  formatPickPrice,
  formatPickSincePct,
  pickReturnSincePublishPct,
  suggestedPickPrice,
} from '@/lib/target-price-display'
import { cn } from '@/lib/utils'
import type { Pick } from '@/types'

type Props = {
  pick: Pick
  compact?: boolean
}

export default function PickPriceTrack({ pick, compact = false }: Props) {
  const suggested = suggestedPickPrice(pick)
  const now = pick.current_price
  const sincePct = pickReturnSincePublishPct(pick)
  const isUp = sincePct != null && sincePct > 0.05
  const isDown = sincePct != null && sincePct < -0.05

  const badgeClass = isUp
    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
    : isDown
      ? 'bg-red-500/15 text-red-300 border-red-500/25'
      : 'bg-zinc-800/80 text-zinc-300 border-white/10'

  const Icon = isUp ? TrendingUp : isDown ? TrendingDown : Minus

  return (
    <div
      className={cn(
        'rounded-lg border border-white/[0.06] bg-black/25',
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5',
      )}
      aria-label={
        sincePct != null
          ? `Suggested ${formatPickPrice(suggested)}, live ${formatPickPrice(now)}, ${formatPickSincePct(sincePct)} since suggested`
          : `Suggested ${formatPickPrice(suggested)}, live ${formatPickPrice(now)}`
      }
    >
      <div className="flex items-center gap-2.5">
        <div className="flex-1 min-w-0 grid grid-cols-2 gap-2">
          <div>
            <p className="text-xs text-zinc-500 leading-none mb-1">Suggested</p>
            <p className="text-base font-bold text-zinc-300 tabular-nums leading-tight">
              {formatPickPrice(suggested)}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500 leading-none mb-1">Live</p>
            <p className="text-base font-bold text-white tabular-nums leading-tight">
              {formatPickPrice(now)}
            </p>
          </div>
        </div>

        {sincePct != null ? (
          <div className="shrink-0 text-center">
            <p className="text-xs text-zinc-500 leading-none mb-1">Change</p>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-lg border px-2 py-1.5 min-h-[36px]',
                'text-sm font-black tabular-nums',
                badgeClass,
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              {formatPickSincePct(sincePct)}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  )
}
