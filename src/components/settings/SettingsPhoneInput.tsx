import { cn } from '@/lib/utils'

type Props = {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

export function digitsOnlyIndianMobile(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10)
}

export default function SettingsPhoneInput({ id, value, onChange, disabled, className }: Props) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <span className="shrink-0 h-11 px-3 flex items-center rounded-xl bg-zinc-950/80 text-zinc-400 text-sm font-semibold border border-white/[0.08]">
        +91
      </span>
      <input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        placeholder="9876543210"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(digitsOnlyIndianMobile(e.target.value))}
        className={cn(
          'flex-1 min-w-0 h-11 px-3 rounded-xl bg-zinc-950/80 border border-white/[0.08]',
          'text-white text-[15px] tabular-nums placeholder:text-zinc-600',
          'focus:outline-none focus:ring-2 focus:ring-blue-500/40',
          disabled && 'opacity-50',
        )}
      />
    </div>
  )
}
