import { AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  message: string
  tone?: 'error' | 'info'
  className?: string
}

export default function SettingsAlert({ message, tone = 'error', className }: Props) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-2xl px-4 py-3 border',
        tone === 'error' && 'bg-red-500/10 border-red-500/15 text-red-400',
        tone === 'info' && 'bg-blue-500/10 border-blue-500/15 text-blue-300',
        className,
      )}
      role="alert"
    >
      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-sm leading-snug">{message}</p>
    </div>
  )
}
