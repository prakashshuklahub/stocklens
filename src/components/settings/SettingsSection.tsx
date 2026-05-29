import { cn } from '@/lib/utils'

type Props = {
  title?: string
  footer?: string
  children: React.ReactNode
  className?: string
}

export default function SettingsSection({ title, footer, children, className }: Props) {
  return (
    <section className={cn('space-y-2', className)}>
      {title && (
        <h2 className="px-1 text-[11px] font-bold uppercase tracking-[0.08em] text-zinc-500">
          {title}
        </h2>
      )}
      <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/60 overflow-hidden divide-y divide-white/[0.06]">
        {children}
      </div>
      {footer && <p className="px-1 text-xs text-zinc-600 leading-relaxed">{footer}</p>}
    </section>
  )
}
