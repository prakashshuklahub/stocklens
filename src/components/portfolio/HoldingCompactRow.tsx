'use client'

import { TIER_BADGE_LABELS } from '@/lib/portfolio-alerts'
import { computeHoldingMetrics, fmtHolding, dayChangePerShare } from '@/lib/portfolio-holding-metrics'
import { cn } from '@/lib/utils'
import type { HoldingSignalTier, PortfolioHoldingWithSignal } from '@/types'

function tierDotClass(tier: HoldingSignalTier): string {
  if (tier === 'attention') return 'bg-red-400'
  if (tier === 'soft') return 'bg-amber-400'
  if (tier === 'profit') return 'bg-emerald-400'
  return 'bg-transparent'
}

export default function HoldingCompactRow({ h }: { h: PortfolioHoldingWithSignal }) {
  const { price, change1d, currentValue, pnl, pnlPct, isPos } = computeHoldingMetrics(h)
  const flagged = h.signal.tier !== 'quiet'
  const dayShare =
    price != null && change1d != null ? dayChangePerShare(price, change1d) : null

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 min-h-[52px]">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          {flagged && (
            <span
              className={cn('w-1.5 h-1.5 rounded-full shrink-0', tierDotClass(h.signal.tier))}
              title={TIER_BADGE_LABELS[h.signal.tier as keyof typeof TIER_BADGE_LABELS]}
              aria-hidden="true"
            />
          )}
          <span className="text-sm font-bold text-white tracking-tight shrink-0">{h.ticker}</span>
        </div>
        <p className="text-xs text-zinc-500 tabular-nums truncate mt-0.5">
          {price != null ? `$${fmtHolding(price)}` : '—'}
          {dayShare != null && change1d != null && (
            <span className={change1d >= 0 ? ' text-emerald-400/90' : ' text-red-400/90'}>
              {' '}
              (1D: {dayShare >= 0 ? '+' : '-'}${fmtHolding(Math.abs(dayShare))})
            </span>
          )}
        </p>
      </div>

      <div className="text-right shrink-0 tabular-nums">
        <p className="text-sm font-bold text-white leading-tight">
          {currentValue != null ? `$${fmtHolding(currentValue)}` : '—'}
        </p>
        {pnl != null && pnlPct != null && isPos != null && (
          <p className={cn('text-xs font-semibold mt-0.5', isPos ? 'text-emerald-400' : 'text-red-400')}>
            P&L: {isPos ? '+' : '-'}${fmtHolding(Math.abs(pnl))}
            <span className="opacity-90 font-medium">
              {' '}({isPos ? '+' : ''}{fmtHolding(pnlPct)}%)
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
