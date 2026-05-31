'use client'

import { computeHoldingMetrics, fmtHolding, dayChangePerShare } from '@/lib/portfolio-holding-metrics'
import { cn } from '@/lib/utils'
import type { PortfolioHoldingWithSignal } from '@/types'

export default function HoldingCompactRow({ h }: { h: PortfolioHoldingWithSignal }) {
  const { price, change1d, currentValue, pnl, pnlPct, isPos } = computeHoldingMetrics(h)
  const dayShare =
    price != null && change1d != null ? dayChangePerShare(price, change1d) : null

  return (
    <div className="flex items-center gap-2.5 px-3 py-3 min-h-[56px]">
      <div className="flex-1 min-w-0">
        <span className="text-base font-bold text-white tracking-tight">{h.ticker}</span>
        <p className="text-sm text-zinc-500 tabular-nums truncate mt-0.5">
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
        <p className="text-base font-bold text-white leading-tight">
          {currentValue != null ? `$${fmtHolding(currentValue)}` : '—'}
        </p>
        {pnl != null && pnlPct != null && isPos != null && (
          <p className={cn('text-sm font-semibold mt-0.5', isPos ? 'text-emerald-400' : 'text-red-400')}>
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
