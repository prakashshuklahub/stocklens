'use client'

import HoldingCompactRow from '@/components/portfolio/HoldingCompactRow'
import type { PortfolioHoldingWithSignal } from '@/types'

export default function HoldingsCompactList({
  holdings,
}: {
  holdings: PortfolioHoldingWithSignal[]
}) {
  return (
    <div className="card-surface overflow-hidden divide-y divide-white/[0.06]">
      {holdings.map((h) => (
        <HoldingCompactRow key={h.id} h={h} />
      ))}
    </div>
  )
}
