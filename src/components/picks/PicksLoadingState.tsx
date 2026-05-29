'use client'

import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'

const LOADING_STEPS = [
  'Loading prices and analyst ratings…',
  'Scoring your watchlist and portfolio…',
  'Checking market movers…',
  'Ranking the top 10 by signal strength…',
] as const

function SkeletonBar({ className, delayMs = 0 }: { className?: string; delayMs?: number }) {
  return (
    <div
      className={cn('rounded-md bg-zinc-800/75 animate-pulse', className)}
      style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      aria-hidden="true"
    />
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

        <div className="pick-card-stats rounded-xl px-3 py-2.5 space-y-2.5">
          <SkeletonBar className="h-4 w-[min(100%,15rem)]" delayMs={stagger + 180} />
          <div className="h-px bg-blue-500/10" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <SkeletonBar className="h-5 w-28" delayMs={stagger + 200} />
            <SkeletonBar className="h-5 w-24" delayMs={stagger + 220} />
          </div>
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

function PicksLoadingBanner() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const id = window.setInterval(() => {
      setStep((current) => (current + 1) % LOADING_STEPS.length)
    }, 2400)
    return () => window.clearInterval(id)
  }, [])

  return (
    <div className="rounded-2xl border border-amber-500/15 bg-gradient-to-br from-amber-500/[0.08] via-zinc-900/40 to-violet-500/[0.04] px-4 py-3.5 mb-4">
      <div className="flex items-start gap-3">
        <div className="relative shrink-0 mt-0.5">
          <Sparkles className="w-5 h-5 text-amber-400/90" aria-hidden="true" />
          <Loader2
            className="absolute -right-1 -bottom-1 w-3 h-3 text-amber-300 animate-spin"
            aria-hidden="true"
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-50/95">Building your top 10 picks</p>
          <p className="type-meta text-zinc-400 mt-1" aria-live="polite">
            {LOADING_STEPS[step]}
          </p>
          <div className="mt-3 h-1 rounded-full bg-zinc-800/90 overflow-hidden">
            <div className="pick-loading-bar h-full w-1/3 rounded-full bg-gradient-to-r from-transparent via-amber-400/70 to-transparent" />
          </div>
          <p className="type-meta text-zinc-600 mt-2">Usually takes a few seconds the first time</p>
        </div>
      </div>
    </div>
  )
}

export default function PicksLoadingState() {
  return (
    <section aria-label="Loading stock picks" aria-busy="true">
      <PicksLoadingBanner />
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
