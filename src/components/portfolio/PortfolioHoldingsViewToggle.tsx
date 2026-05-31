'use client'

import { cn } from '@/lib/utils'

export type PortfolioHoldingsView = 'cards' | 'compact' | 'table'

export const DEFAULT_PORTFOLIO_HOLDINGS_VIEW: PortfolioHoldingsView = 'cards'

const STORAGE_KEY = 'portfolio-holdings-view'

const OPTIONS: { id: PortfolioHoldingsView; label: string }[] = [
  { id: 'cards', label: 'Cards' },
  { id: 'compact', label: 'Compact' },
  { id: 'table', label: 'Table' },
]

export function loadPortfolioHoldingsView(): PortfolioHoldingsView {
  if (typeof window === 'undefined') return DEFAULT_PORTFOLIO_HOLDINGS_VIEW
  const stored = sessionStorage.getItem(STORAGE_KEY)
  if (stored === 'compact' || stored === 'table') return stored
  return DEFAULT_PORTFOLIO_HOLDINGS_VIEW
}

export function persistPortfolioHoldingsView(view: PortfolioHoldingsView): void {
  sessionStorage.setItem(STORAGE_KEY, view)
}

export default function PortfolioHoldingsViewToggle({
  value,
  onChange,
}: {
  value: PortfolioHoldingsView
  onChange: (view: PortfolioHoldingsView) => void
}) {
  return (
    <div
      className="inline-flex rounded-lg bg-zinc-900/80 p-0.5 border border-white/[0.06]"
      role="group"
      aria-label="Holdings view"
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(opt.id)}
            className={cn(
              'px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors [touch-action:manipulation] min-h-[32px]',
              active ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 active:text-zinc-300',
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
