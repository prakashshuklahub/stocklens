import ReasonChip from '@/components/signals/ReasonChip'
import type { SignalReason } from '@/types'

const MAX_REASON_CHIPS = 5

export default function SignalReasonChips({
  reasons,
  className,
}: {
  reasons: SignalReason[]
  className?: string
}) {
  const visible = reasons.slice(0, MAX_REASON_CHIPS)
  if (!visible.length) return null

  return (
    <div className={className ?? 'flex flex-wrap gap-1.5 mt-2.5'}>
      {visible.map((r, i) => (
        <ReasonChip key={`${r.label}-${i}`} reason={r} />
      ))}
    </div>
  )
}
