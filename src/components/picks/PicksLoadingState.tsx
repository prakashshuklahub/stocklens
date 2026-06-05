'use client'

import { cn } from '@/lib/utils'

function SkeletonBar({ className, delayMs = 0 }: { className?: string; delayMs?: number }) {
  return (
    <div
      className={cn('rounded-md bg-zinc-800/75 animate-pulse', className)}
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      aria-hidden="true"
    />
  )
}

function PicksMetaSkeleton() {
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-zinc-900/60 px-3 py-2.5">
      <SkeletonBar className="h-4 w-48 max-w-[70%]" />
      <SkeletonBar className="h-11 w-11 rounded-xl shrink-0" delayMs={40} />
    </div>
  )
}

function PickCardSkeleton({ rank }: { rank: number }) {
  const stagger = rank * 60

  return (
    <div
      className={cn(
        'pick-card overflow-hidden',
        rank === 1 && 'pick-card--top',
        rank >= 2 && rank <= 3 && 'pick-card--ranked',
      )}
      aria-hidden="true"
    >
      <div className="pick-card-hero px-4 pt-5 pb-3.5">
        <div className="relative flex items-start gap-2.5 sm:gap-3 mb-3">
          <SkeletonBar className="w-10 h-10 rounded-xl shrink-0" delayMs={stagger} />
          <SkeletonBar className="w-10 h-10 rounded-full shrink-0" delayMs={stagger + 40} />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <SkeletonBar className="h-5 w-16" delayMs={stagger + 80} />
              <SkeletonBar className="h-5 w-[5.5rem] rounded-full" delayMs={stagger + 100} />
            </div>
            <SkeletonBar className="h-4 w-[min(100%,12rem)]" delayMs={stagger + 120} />
            <div className="flex gap-2 flex-wrap">
              <SkeletonBar className="h-4 w-14 rounded-full" delayMs={stagger + 140} />
              <SkeletonBar className="h-4 w-20 rounded-full" delayMs={stagger + 160} />
            </div>
          </div>
        </div>

        <div className="pick-card-stats rounded-xl p-3 space-y-2.5">
          <SkeletonBar className="h-[4.5rem] w-full rounded-lg" delayMs={stagger + 180} />
          <div className="grid grid-cols-2 gap-2">
            <SkeletonBar className="h-14 w-full rounded-lg" delayMs={stagger + 200} />
            <SkeletonBar className="h-14 w-full rounded-lg" delayMs={stagger + 220} />
          </div>
          <SkeletonBar className="h-4 w-40 mx-auto" delayMs={stagger + 240} />
        </div>
      </div>

      <div className="border-t border-amber-500/10 bg-zinc-950/35">
        <div className="px-2 py-2">
          <div className="flex items-stretch gap-1">
            {[0, 1, 2, 3, 4, 5].map((tab) => (
              <div key={tab} className="flex-1 flex flex-col items-center gap-1 py-2">
                <SkeletonBar className="h-4 w-4 rounded-sm" delayMs={stagger + 240 + tab * 20} />
                <SkeletonBar className="h-2 w-8" delayMs={stagger + 255 + tab * 20} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function PicksLoadingState() {
  return (
    <section aria-label="Loading stock picks" aria-busy="true">
      <PicksMetaSkeleton />
      <ul className="space-y-3">
        {[1, 2, 3, 4, 5].map((rank) => (
          <li key={rank}>
            <PickCardSkeleton rank={rank} />
          </li>
        ))}
      </ul>
    </section>
  )
}
