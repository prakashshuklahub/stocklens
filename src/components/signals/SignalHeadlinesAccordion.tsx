'use client'

import { useState } from 'react'
import { Newspaper } from 'lucide-react'
import CollapseChevron from '@/components/CollapseChevron'
import NewsRow from '@/components/NewsRow'
import { cn } from '@/lib/utils'
import type { Signal, SignalNewsItem } from '@/types'

function truncatePreview(text: string, max = 72): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).trim()}…`
}

function headlinesBorderClass(bias: Signal['bias'] | undefined): string {
  if (bias === 'bullish') return 'border-emerald-500/10'
  if (bias === 'bearish') return 'border-red-500/10'
  return 'border-white/[0.04]'
}

function headlinesPreview(news: SignalNewsItem[]): string {
  const top = news[0]
  if (top) return truncatePreview(top.title)
  return 'No headlines right now'
}

export default function SignalHeadlinesAccordion({
  cardId,
  news,
  bias,
  inset = false,
}: {
  cardId: string
  news: SignalNewsItem[]
  bias?: Signal['bias']
  inset?: boolean
}) {
  const [open, setOpen] = useState(false)
  const preview = headlinesPreview(news)

  return (
    <div className={cn('border-t bg-zinc-950/35', headlinesBorderClass(bias))}>
      <button
        type="button"
        id={`${cardId}-headlines-trigger`}
        aria-expanded={open}
        aria-controls={`${cardId}-headlines-panel`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full text-left min-h-[48px]',
          inset ? 'px-5 py-3' : 'px-4 py-3',
          'active:bg-zinc-800/50 transition-colors [touch-action:manipulation]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Newspaper className="w-3.5 h-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
              <span className="type-meta font-semibold text-zinc-300">Headlines</span>
            </div>
            {!open && (
              <p className="type-meta text-muted-preview mt-1 leading-snug truncate">{preview}</p>
            )}
          </div>
          <CollapseChevron open={open} className="text-muted shrink-0 mt-0.5" />
        </div>
      </button>
      {open && (
        <div
          id={`${cardId}-headlines-panel`}
          role="region"
          aria-labelledby={`${cardId}-headlines-trigger`}
          className={cn('pb-3.5 pt-0 space-y-2', inset ? 'px-5' : 'px-4')}
        >
          {news.length ? (
            news.map((n, i) => (
              <NewsRow key={`${n.url}-${i}`} item={n} />
            ))
          ) : (
            <p className="text-xs text-muted px-1 py-2">No headlines for this stock right now.</p>
          )}
        </div>
      )}
    </div>
  )
}
