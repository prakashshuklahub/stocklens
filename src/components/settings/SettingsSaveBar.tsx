'use client'

import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Props = {
  visible: boolean
  saving: boolean
  saved: boolean
  disabled?: boolean
  onSave: () => void
  label?: string
}

export default function SettingsSaveBar({
  visible,
  saving,
  saved,
  disabled,
  onSave,
  label = 'Save changes',
}: Props) {
  return (
    <div
      className={cn(
        'fixed inset-x-0 z-30 px-5 transition-all duration-300 ease-out',
        'bottom-[calc(var(--nav-height)+env(safe-area-inset-bottom,0px)+0.75rem)]',
        visible ? 'translate-y-0 opacity-100 pointer-events-auto' : 'translate-y-4 opacity-0 pointer-events-none',
      )}
    >
      <div className="max-w-xl mx-auto">
        <button
          type="button"
          onClick={onSave}
          disabled={disabled || saving}
          className={cn(
            'w-full h-12 rounded-2xl text-[15px] font-semibold shadow-lg shadow-black/30',
            '[touch-action:manipulation] active:scale-[0.98] transition-all',
            'disabled:opacity-40 disabled:cursor-not-allowed',
            saved
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/25'
              : 'bg-blue-500 text-white',
          )}
        >
          {saving ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Saving…
            </span>
          ) : saved ? (
            <span className="inline-flex items-center gap-2">
              <Check className="w-4 h-4" aria-hidden="true" />
              Saved
            </span>
          ) : (
            label
          )}
        </button>
      </div>
    </div>
  )
}
