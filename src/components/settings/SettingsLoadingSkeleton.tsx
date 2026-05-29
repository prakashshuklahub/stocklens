export default function SettingsLoadingSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Loading settings">
      <div className="flex items-center gap-4 px-1">
        <div className="w-14 h-14 rounded-2xl bg-zinc-800/80" />
        <div className="flex-1 space-y-2">
          <div className="h-5 w-32 rounded-lg bg-zinc-800/80" />
          <div className="h-4 w-48 rounded-lg bg-zinc-800/60" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-20 rounded bg-zinc-800/50 ml-1" />
        <div className="rounded-2xl border border-white/[0.04] overflow-hidden divide-y divide-white/[0.04]">
          <div className="h-[72px] bg-zinc-900/40" />
          <div className="h-[88px] bg-zinc-900/40" />
        </div>
      </div>
    </div>
  )
}
