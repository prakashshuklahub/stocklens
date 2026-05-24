import { ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SignalNewsItem } from '@/types'

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

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
            <span className="type-meta text-muted">{timeAgo(item.published_at)}</span>
          </div>
        </div>
        <ExternalLink className="w-3.5 h-3.5 text-muted shrink-0 mt-0.5" aria-hidden="true" />
      </div>
    </a>
  )
}
