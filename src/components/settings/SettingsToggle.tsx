'use client'

import { cn } from '@/lib/utils'

type Props = {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

export default function SettingsToggle({
  checked,
  onChange,
  disabled,
  id,
  'aria-label': ariaLabel,
}: Props) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-200',
        '[touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
        checked ? 'bg-emerald-500' : 'bg-zinc-700',
        disabled && 'opacity-40 cursor-not-allowed',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute top-[2px] left-[2px] h-[27px] w-[27px] rounded-full bg-white shadow-md transition-transform duration-200',
          checked && 'translate-x-5',
        )}
      />
    </button>
  )
}
