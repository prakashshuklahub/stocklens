import { cn } from '@/lib/utils'

type Props = {
  label: string
  description?: string
  meta?: string
  trailing?: React.ReactNode
  children?: React.ReactNode
  htmlFor?: string
  className?: string
  disabled?: boolean
}

export default function SettingsRow({
  label,
  description,
  meta,
  trailing,
  children,
  htmlFor,
  className,
  disabled,
}: Props) {
  const body = (
    <>
      <div className="min-w-0 flex-1 pr-3">
        <p className={cn('text-[15px] font-medium text-white leading-snug', disabled && 'text-zinc-500')}>
          {label}
        </p>
        {description && (
          <p className="mt-0.5 text-[13px] text-zinc-500 leading-relaxed [text-wrap:pretty]">{description}</p>
        )}
        {meta && (
          <p className="mt-1.5 text-xs text-zinc-600 tabular-nums">{meta}</p>
        )}
      </div>
      {children && <div className="shrink-0 flex items-center">{children}</div>}
      {!children && trailing && (
        <div className="shrink-0 text-sm text-zinc-500 tabular-nums">{trailing}</div>
      )}
    </>
  )

  if (htmlFor) {
    return (
      <label
        htmlFor={htmlFor}
        className={cn(
          'flex items-start justify-between gap-3 min-h-[52px] px-4 py-3.5',
          '[touch-action:manipulation] active:bg-zinc-800/40 transition-colors cursor-pointer',
          disabled && 'opacity-50 pointer-events-none',
          className,
        )}
      >
        {body}
      </label>
    )
  }

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 min-h-[52px] px-4 py-3.5',
        disabled && 'opacity-50',
        className,
      )}
    >
      {body}
    </div>
  )
}
