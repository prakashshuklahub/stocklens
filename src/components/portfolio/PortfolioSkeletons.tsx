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

const HOLDING_VARIANTS = ['attention', 'soft', 'profit', 'quiet'] as const
type HoldingSkeletonVariant = (typeof HOLDING_VARIANTS)[number]

function holdingBorderClass(variant: HoldingSkeletonVariant): string {
  if (variant === 'attention') return 'border-red-500/20'
  if (variant === 'soft') return 'border-amber-500/15'
  if (variant === 'profit') return 'border-emerald-500/15'
  return 'border-white/[0.06]'
}

function holdingSignalBorderClass(variant: HoldingSkeletonVariant): string {
  if (variant === 'attention') return 'border-red-500/10'
  if (variant === 'soft') return 'border-amber-500/10'
  if (variant === 'profit') return 'border-emerald-500/10'
  return 'border-white/[0.06]'
}

export function PortfolioSummarySkeleton() {
  return (
    <div className="portfolio-summary mb-4" aria-hidden="true">
      <div className="portfolio-summary-inner px-4 py-3">
        <SkeletonBar className="h-3 w-24 mb-1" />
        <SkeletonBar className="h-8 w-36 mt-1" delayMs={40} />

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

function FilterChipSkeleton({ width, delayMs }: { width: string; delayMs: number }) {
  return <SkeletonBar className={cn('h-9 rounded-full', width)} delayMs={delayMs} />
}

export function PortfolioFilterSkeleton() {
  return (
    <div
      className={cn(
        'mb-3 rounded-2xl border border-white/[0.08] bg-zinc-900/70 p-2',
        'shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)]',
      )}
      aria-hidden="true"
    >
      <div className="flex flex-wrap gap-2 py-0.5 px-0.5">
        <FilterChipSkeleton width="w-12" delayMs={0} />
        <FilterChipSkeleton width="w-[7.5rem]" delayMs={30} />
        <FilterChipSkeleton width="w-[6.5rem]" delayMs={60} />
        <FilterChipSkeleton width="w-[7rem]" delayMs={90} />
      </div>
    </div>
  )
}

export function HoldingCardSkeleton({
  rank = 1,
  variant = 'attention',
}: {
  rank?: number
  variant?: HoldingSkeletonVariant
}) {
  const stagger = rank * 60
  const flagged = variant !== 'quiet'

  return (
    <div className={cn('card-surface overflow-hidden', holdingBorderClass(variant))} aria-hidden="true">
      <div className="px-4 py-3.5">
        <div className="flex gap-3">
          <SkeletonBar className="h-10 w-10 rounded-xl shrink-0" delayMs={stagger} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <SkeletonBar className="h-6 w-14" delayMs={stagger + 30} />
                  {flagged && <SkeletonBar className="h-5 w-[7.5rem] rounded-full" delayMs={stagger + 50} />}
                </div>
                <SkeletonBar className="h-4 w-[min(100%,10rem)]" delayMs={stagger + 70} />
              </div>
              <div className="text-right shrink-0 space-y-1">
                <SkeletonBar className="h-6 w-20 ml-auto" delayMs={stagger + 40} />
                <SkeletonBar className="h-4 w-24 ml-auto" delayMs={stagger + 55} />
              </div>
            </div>
            <div className="mt-3 pt-3 border-t border-white/[0.06] grid grid-cols-3 gap-x-4 gap-y-3">
              <SkeletonBar className="h-10 w-full" delayMs={stagger + 80} />
              <SkeletonBar className="h-10 w-full" delayMs={stagger + 90} />
              <SkeletonBar className="h-10 w-full" delayMs={stagger + 100} />
            </div>
          </div>
        </div>
      </div>

      {flagged && (
        <div className={cn('border-t bg-black/20 px-4 py-2 min-h-[48px]', holdingSignalBorderClass(variant))}>
          <div className="flex items-center justify-between gap-2 min-h-[32px]">
            <div className="min-w-0 flex-1 flex items-center gap-1.5">
              <SkeletonBar className="h-3 w-3 rounded-sm shrink-0" delayMs={stagger + 150} />
              <SkeletonBar className="h-3 w-28 shrink-0" delayMs={stagger + 165} />
              <SkeletonBar className="h-3 w-1 shrink-0 opacity-40" delayMs={stagger + 170} aria-hidden="true" />
              <SkeletonBar className="h-3 w-[min(100%,6rem)]" delayMs={stagger + 180} />
            </div>
            <SkeletonBar className="h-4 w-4 rounded shrink-0" delayMs={stagger + 195} />
          </div>
        </div>
      )}
    </div>
  )
}

export function PortfolioHoldingsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <HoldingCardSkeleton
          key={i}
          rank={i + 1}
          variant={HOLDING_VARIANTS[i % HOLDING_VARIANTS.length]}
        />
      ))}
    </div>
  )
}

export function PortfolioCompactHoldingsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="card-surface overflow-hidden divide-y divide-white/[0.06]" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3 px-3 py-2.5 min-h-[52px]">
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 w-12 rounded bg-zinc-800/75 animate-pulse" style={{ animationDelay: `${i * 40}ms` }} />
            <div className="h-3 w-28 rounded bg-zinc-800/60 animate-pulse" style={{ animationDelay: `${i * 40 + 20}ms` }} />
          </div>
          <div className="space-y-1.5 text-right">
            <div className="h-3.5 w-16 rounded bg-zinc-800/75 animate-pulse ml-auto" style={{ animationDelay: `${i * 40 + 10}ms` }} />
            <div className="h-3 w-14 rounded bg-zinc-800/60 animate-pulse ml-auto" style={{ animationDelay: `${i * 40 + 30}ms` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function PortfolioTableHoldingsSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="card-surface overflow-hidden" aria-hidden="true">
      <div className="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] gap-x-2 px-3 py-2.5 border-b border-white/[0.06]">
        <SkeletonBar className="h-3 w-10" />
        <SkeletonBar className="h-3 w-10 ml-auto" />
        <SkeletonBar className="h-3 w-10 ml-auto" />
      </div>
      <div className="divide-y divide-white/[0.06]">
        {Array.from({ length: count }, (_, i) => (
          <div
            key={i}
            className="grid grid-cols-[minmax(0,1fr)_5rem_5.5rem] gap-x-2 items-center px-3 py-3 min-h-[58px]"
          >
            <div className="flex items-center gap-2 min-w-0">
              <SkeletonBar className="h-8 w-8 rounded-lg shrink-0" delayMs={i * 40} />
              <div className="flex-1 space-y-1.5 min-w-0">
                <SkeletonBar className="h-3.5 w-12" delayMs={i * 40 + 20} />
                <SkeletonBar className="h-3 w-20" delayMs={i * 40 + 35} />
              </div>
            </div>
            <SkeletonBar className="h-8 w-full" delayMs={i * 40 + 10} />
            <SkeletonBar className="h-8 w-full" delayMs={i * 40 + 15} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function PortfolioLoadingState({
  count = 4,
  showSummary = true,
}: {
  count?: number
  showSummary?: boolean
}) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading portfolio">
      {showSummary && <PortfolioSummarySkeleton />}
      <PortfolioHoldingsSkeleton count={count} />
    </div>
  )
}
