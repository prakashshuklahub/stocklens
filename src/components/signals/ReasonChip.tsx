import { cn } from '@/lib/utils'
import type { SignalReason } from '@/types'

export default function ReasonChip({ reason }: { reason: SignalReason }) {
  const styles =
    reason.tone === 'bullish' ? 'bg-emerald-500/10 text-emerald-300' :
    reason.tone === 'bearish' ? 'bg-red-500/10 text-red-300' :
    'bg-zinc-800 text-zinc-400'
  return (
    <span className={cn('watchlist-chip', styles)}>
      {reason.label}
    </span>
  )
}
