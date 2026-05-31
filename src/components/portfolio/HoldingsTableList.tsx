'use client'

import { useMemo } from 'react'
import HoldingTableRow from '@/components/portfolio/HoldingTableRow'
import { computePortfolioTotalValue } from '@/lib/portfolio-holding-metrics'
import type { PortfolioHoldingWithSignal } from '@/types'

export default function HoldingsTableList({
  holdings,
}: {
  holdings: PortfolioHoldingWithSignal[]
}) {
  const totalValue = useMemo(() => computePortfolioTotalValue(holdings), [holdings])

  return (
    <div className="card-surface overflow-hidden">
      <div
        className="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] gap-x-2 items-center px-3 py-2.5 border-b border-white/[0.06] bg-zinc-900/40"
        aria-hidden="true"
      >
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide">Stock</span>
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide text-right">Today</span>
        <span className="text-xs font-medium text-zinc-500 uppercase tracking-wide text-right">Total</span>
      </div>
      <div className="divide-y divide-white/[0.06]">
        {holdings.map((h) => (
          <HoldingTableRow key={h.id} h={h} totalPortfolioValue={totalValue} />
        ))}
      </div>
    </div>
  )
}
