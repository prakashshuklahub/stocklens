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

/** Collapsed watchlist card placeholder — logo, price, chips, accordion rows. */
export default function WatchlistCardSkeleton({ rank = 1 }: { rank?: number }) {
  const stagger = rank * 60

  return (
    <div className="relative card-surface overflow-hidden" aria-hidden="true">
      <div className="px-5 pt-4 pb-2 pr-14">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <SkeletonBar className="h-10 w-10 rounded-xl shrink-0" delayMs={stagger} />
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBar className="h-5 w-16" delayMs={stagger + 30} />
              <SkeletonBar className="h-4 w-[min(100%,11rem)]" delayMs={stagger + 60} />
            </div>
          </div>
          <div className="text-right shrink-0 space-y-1.5">
            <SkeletonBar className="h-5 w-20 ml-auto" delayMs={stagger + 40} />
            <SkeletonBar className="h-4 w-14 ml-auto" delayMs={stagger + 70} />
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <SkeletonBar className="h-6 w-20 rounded-full" delayMs={stagger + 90} />
          <SkeletonBar className="h-6 w-16 rounded-full" delayMs={stagger + 110} />
          <SkeletonBar className="h-6 w-24 rounded-full" delayMs={stagger + 130} />
        </div>
      </div>

      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="border-t border-white/[0.04] px-5 py-3 min-h-[48px]">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex items-center gap-1.5">
                <SkeletonBar className="h-3.5 w-3.5 rounded-sm shrink-0" delayMs={stagger + 150 + row * 25} />
                <SkeletonBar className="h-3 w-24" delayMs={stagger + 165 + row * 25} />
              </div>
              <SkeletonBar className="h-3 w-[min(100%,12rem)]" delayMs={stagger + 180 + row * 25} />
            </div>
            <SkeletonBar className="h-4 w-4 rounded shrink-0 mt-0.5" delayMs={stagger + 195 + row * 25} />
          </div>
        </div>
      ))}

      <div className="absolute right-3 top-3">
        <SkeletonBar className="h-8 w-8 rounded-lg" delayMs={stagger + 20} />
      </div>
    </div>
  )
}
