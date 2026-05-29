'use client'

import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export default function WatchlistCollapsibleGroup({
  groupId,
  label,
  count,
  defaultOpen = true,
  listLabel,
  children,
}: {
  groupId: string
  label: string
  count: number
  defaultOpen?: boolean
  listLabel?: string
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = `watchlist-group-${groupId}`

  return (
    <section aria-labelledby={id}>
      <button
        type="button"
        id={id}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-0.5 min-h-[44px] focus-visible:outline-none [touch-action:manipulation]"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-[0.1em]">
            {label}
          </span>
          <span className="type-micro text-zinc-600 tabular-nums">{count}</span>
        </div>
        <ChevronDown
          className={cn('w-4 h-4 text-zinc-600 transition-transform', open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {open && (
        <ul
          id={`${id}-list`}
          className="space-y-3 mt-2 mb-6"
          aria-label={listLabel ?? `${label} stocks`}
        >
          {children}
        </ul>
      )}

      {!open && <div className="mb-3" />}
    </section>
  )
}
