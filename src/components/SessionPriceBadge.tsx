import type { MarketSession } from '@/lib/market-hours'
import { cn } from '@/lib/utils'

const LABELS: Record<Exclude<MarketSession, 'regular'>, string> = {
  pre: 'Pre-market',
  post: 'After-hours',
  closed: 'Closed',
}

export default function SessionPriceBadge({
  session,
  className,
}: {
  session?: MarketSession
  className?: string
}) {
  if (!session || session === 'regular') return null

  return (
    <span
      className={cn(
        'text-[10px] font-semibold uppercase tracking-wide text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-800/80',
        className,
      )}
    >
      {LABELS[session]}
    </span>
  )
}
