'use client'

import { ExternalLink } from 'lucide-react'
import ClientTimeAgo from '@/components/ClientTimeAgo'
import { cn } from '@/lib/utils'
import type { SignalNewsItem } from '@/types'

export default function NewsRow({ item }: { item: SignalNewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl px-3 py-2.5 -mx-1 active:bg-zinc-800/60 transition-colors [touch-action:manipulation]"
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            'w-1 self-stretch rounded-full mt-0.5 shrink-0',
            item.sentiment === 'bullish' ? 'bg-emerald-500/60' : 'bg-red-500/60',
          )}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-200 leading-snug">{item.title}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="type-meta text-zinc-500">{item.source}</span>
            <span className="type-meta text-muted">·</span>
            <ClientTimeAgo iso={item.published_at} className="type-meta text-muted" />
          </div>
        </div>
        <ExternalLink className="w-3.5 h-3.5 text-muted shrink-0 mt-0.5" aria-hidden="true" />
      </div>
    </a>
  )
}
