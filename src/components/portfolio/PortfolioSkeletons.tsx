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

export function PortfolioSummarySkeleton() {
  return (
    <div className="portfolio-summary mb-4" aria-hidden="true">
      <div className="portfolio-summary-inner px-4 py-3">
        <SkeletonBar className="h-3 w-24 mb-2" />
        <SkeletonBar className="h-8 w-36" delayMs={40} />
        <div className="mt-3 flex items-center justify-between gap-3">
          <SkeletonBar className="h-4 w-12" delayMs={80} />
          <SkeletonBar className="h-4 w-28" delayMs={100} />
        </div>
        <div className="mt-2 pt-2 border-t border-white/[0.06] flex items-center justify-between gap-3">
          <SkeletonBar className="h-4 w-24" delayMs={120} />
          <SkeletonBar className="h-4 w-32" delayMs={140} />
        </div>
      </div>
    </div>
  )
}

export function HoldingCardSkeleton({ rank = 1, flagged = true }: { rank?: number; flagged?: boolean }) {
  const stagger = rank * 60

  return (
    <div className="card-surface overflow-hidden border-white/[0.06]" aria-hidden="true">
      <div className="px-4 py-3.5 space-y-2.5">
        <div className="flex items-start gap-3">
          <SkeletonBar className="h-10 w-10 rounded-xl shrink-0" delayMs={stagger} />
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <SkeletonBar className="h-5 w-14" delayMs={stagger + 30} />
              {flagged && <SkeletonBar className="h-5 w-28 rounded-full" delayMs={stagger + 50} />}
            </div>
            <SkeletonBar className="h-4 w-[min(100%,10rem)]" delayMs={stagger + 70} />
          </div>
          <div className="text-right shrink-0 space-y-1.5">
            <SkeletonBar className="h-5 w-16 ml-auto" delayMs={stagger + 40} />
            <SkeletonBar className="h-4 w-12 ml-auto" delayMs={stagger + 60} />
          </div>
        </div>

        <div className="space-y-1.5">
          <SkeletonBar className="h-3.5 w-40" delayMs={stagger + 90} />
          <SkeletonBar className="h-3.5 w-[min(100%,14rem)]" delayMs={stagger + 110} />
        </div>

        <SkeletonBar className="h-8 w-36 rounded-full" delayMs={stagger + 130} />
      </div>

      {flagged && (
        <div className="border-t border-white/[0.06] bg-black/20 px-4 py-2 min-h-[48px]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 flex items-center gap-1.5">
              <SkeletonBar className="h-3 w-3 rounded-sm shrink-0" delayMs={stagger + 150} />
              <SkeletonBar className="h-3 w-28 shrink-0" delayMs={stagger + 165} />
              <SkeletonBar className="h-3 w-[min(100%,7rem)]" delayMs={stagger + 180} />
            </div>
            <SkeletonBar className="h-4 w-4 rounded shrink-0" delayMs={stagger + 195} />
          </div>
        </div>
      )}
    </div>
  )
}

export function PortfolioLoadingState({
  count = 3,
  showSummary = true,
}: {
  count?: number
  showSummary?: boolean
}) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading portfolio">
      {showSummary && <PortfolioSummarySkeleton />}
      {Array.from({ length: count }, (_, i) => (
        <HoldingCardSkeleton key={i} rank={i + 1} flagged={i !== 1} />
      ))}
    </div>
  )
}
