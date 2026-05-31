'use client'

import StockLogo from '@/components/StockLogo'
import { TIER_BADGE_LABELS } from '@/lib/portfolio-alerts'
import {
  computeHoldingMetrics,
  fmtHolding,
  holdingWeightPct,
} from '@/lib/portfolio-holding-metrics'
import { cn } from '@/lib/utils'
import type { HoldingSignalTier, PortfolioHoldingWithSignal } from '@/types'

function tierDotClass(tier: HoldingSignalTier): string {
  if (tier === 'attention') return 'bg-red-400'
  if (tier === 'soft') return 'bg-amber-400'
  if (tier === 'profit') return 'bg-emerald-400'
  return 'bg-transparent'
}

function pnlTone(isPos: boolean): string {
  return isPos ? 'text-emerald-400' : 'text-red-400'
}

export default function HoldingTableRow({
  h,
  totalPortfolioValue,
}: {
  h: PortfolioHoldingWithSignal
  totalPortfolioValue: number
}) {
  const {
    change1d,
    currentValue,
    pnl,
    pnlPct,
    isPos,
    dayPnl,
  } = computeHoldingMetrics(h)
  const flagged = h.signal.tier !== 'quiet'
  const weightPct = holdingWeightPct(h, totalPortfolioValue)

  const dayPos = dayPnl != null ? dayPnl >= 0 : change1d != null ? change1d >= 0 : null

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_4.75rem_5.25rem] gap-x-2 items-center px-3 py-2.5 min-h-[56px]">
      <div className="flex items-center gap-2 min-w-0">
        <StockLogo ticker={h.ticker} size="sm" className="shrink-0" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 min-w-0">
            {flagged && (
              <span
                className={cn('w-1.5 h-1.5 rounded-full shrink-0', tierDotClass(h.signal.tier))}
                title={TIER_BADGE_LABELS[h.signal.tier as keyof typeof TIER_BADGE_LABELS]}
                aria-hidden="true"
              />
            )}
            <span className="text-sm font-bold text-white tracking-tight truncate">{h.ticker}</span>
          </div>
          <p className="text-[11px] text-zinc-500 tabular-nums truncate mt-0.5 leading-tight">
            {weightPct != null && (
              <span>{fmtHolding(weightPct, weightPct >= 10 ? 0 : 1)}%</span>
            )}
            {weightPct != null && currentValue != null && (
              <span aria-hidden="true"> · </span>
            )}
            {currentValue != null && <span>${fmtHolding(currentValue)}</span>}
            {weightPct == null && currentValue == null && '—'}
          </p>
        </div>
      </div>

      <div className="text-right tabular-nums min-w-0">
        {dayPnl != null && dayPos != null ? (
          <>
            <p className={cn('text-sm font-semibold leading-tight', pnlTone(dayPos))}>
              {dayPos ? '+' : '-'}${fmtHolding(Math.abs(dayPnl))}
            </p>
            {change1d != null && (
              <p className={cn('text-[11px] mt-0.5 leading-tight', pnlTone(change1d >= 0))}>
                {change1d >= 0 ? '+' : ''}{fmtHolding(change1d)}%
              </p>
            )}
          </>
        ) : change1d != null ? (
          <p className={cn('text-sm font-semibold leading-tight', pnlTone(change1d >= 0))}>
            {change1d >= 0 ? '+' : ''}{fmtHolding(change1d)}%
          </p>
        ) : (
          <p className="text-sm font-semibold text-zinc-600">—</p>
        )}
      </div>

      <div className="text-right tabular-nums min-w-0">
        {pnl != null && pnlPct != null && isPos != null ? (
          <>
            <p className={cn('text-sm font-semibold leading-tight', pnlTone(isPos))}>
              {isPos ? '+' : '-'}${fmtHolding(Math.abs(pnl))}
            </p>
            <p className={cn('text-[11px] mt-0.5 leading-tight', pnlTone(isPos))}>
              ({isPos ? '+' : ''}{fmtHolding(pnlPct)}%)
            </p>
          </>
        ) : (
          <p className="text-sm font-semibold text-zinc-600">—</p>
        )}
      </div>
    </div>
  )
}
