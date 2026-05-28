'use client'

import { cn } from '@/lib/utils'

export type FilterChipTone =
  | 'default'
  | 'bullish'
  | 'bearish'
  | 'attention'
  | 'soft'
  | 'profit'
  | 'quiet'

export interface FilterChipOption<T extends string = string> {
  id: T
  label: string
  tone?: FilterChipTone
  /** Overrides tone when the chip is selected (e.g. match pick source badge colors). */
  activeClassName?: string
}

function activeChipClass(tone: FilterChipTone): string {
  switch (tone) {
    case 'bullish':
      return 'bg-emerald-500/20 text-emerald-200 border-emerald-500/35 shadow-[0_0_0_1px_rgb(16_185_129/0.25)]'
    case 'bearish':
      return 'bg-red-500/20 text-red-200 border-red-500/35 shadow-[0_0_0_1px_rgb(239_68_68/0.25)]'
    case 'attention':
      return 'bg-red-500/15 text-red-200 border-red-500/30'
    case 'soft':
      return 'bg-amber-500/15 text-amber-200 border-amber-500/30'
    case 'profit':
      return 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
    case 'quiet':
      return 'bg-zinc-700/80 text-zinc-200 border-zinc-600/50'
    default:
      return 'bg-blue-500/15 text-blue-100 border-blue-400/35 shadow-[0_0_0_1px_rgb(96_165_250/0.2)]'
  }
}

export default function FilterChipBar<T extends string>({
  label,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  label?: string
  value: T
  options: FilterChipOption<T>[]
  onChange: (value: T) => void
  ariaLabel?: string
}) {
  return (
    <div className="mb-3">
      {label && (
        <p className="type-micro font-semibold text-zinc-500 uppercase tracking-[0.1em] mb-2 px-0.5">
          {label}
        </p>
      )}
      <div
        className={cn(
          'rounded-2xl border border-white/[0.08] bg-zinc-900/70 p-2',
          'shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)]',
        )}
      >
        <div
          className="flex flex-wrap gap-2 py-0.5 px-0.5"
          role="group"
          aria-label={ariaLabel ?? label ?? 'Filters'}
        >
          {options.map((opt) => {
            const active = value === opt.id
            const tone = opt.tone ?? 'default'
            return (
              <button
                key={opt.id}
                type="button"
                aria-pressed={active}
                onClick={() => onChange(opt.id)}
                className={cn(
                  'min-h-[36px] px-3.5 rounded-full border text-sm font-semibold',
                  'transition-all duration-150 [touch-action:manipulation]',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950',
                  active
                    ? (opt.activeClassName ?? activeChipClass(tone))
                    : 'bg-zinc-950/50 text-zinc-500 border-white/[0.06] active:bg-zinc-800/80 active:text-zinc-300',
                )}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
