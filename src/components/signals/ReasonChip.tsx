import { cn } from '@/lib/utils'
import type { SignalReason } from '@/types'

export default function ReasonChip({ reason }: { reason: SignalReason }) {
  const styles =
    reason.tone === 'bullish' ? 'bg-emerald-500/10 text-emerald-300' :
    reason.tone === 'bearish' ? 'bg-red-500/10 text-red-300' :
    'bg-zinc-800 text-zinc-400'
  return (
    <span className={cn('text-sm sm:text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap', styles)}>
      {reason.label}
    </span>
  )
}
