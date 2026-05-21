'use client'

import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

export const LIVE_REFRESH_SEC = 15

export function RefreshCountdown({
  seconds,
  refreshing,
  intervalSec = LIVE_REFRESH_SEC,
}: {
  seconds: number
  refreshing: boolean
  intervalSec?: number
}) {
  const pct = ((intervalSec - seconds) / intervalSec) * 100
  return (
    <div
      className="flex items-center gap-2 shrink-0"
      aria-live="polite"
      aria-label={refreshing ? 'Updating prices' : `Prices refresh in ${seconds} seconds`}
    >
      <div className="w-14 h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className="h-full rounded-full bg-blue-500/60 transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-zinc-500 min-w-[3.5rem] text-right">
        {refreshing ? (
          <span className="inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
            Live
          </span>
        ) : (
          `${seconds}s`
        )}
      </span>
    </div>
  )
}

interface LiveRefreshHeaderProps {
  title: string
  subtitle?: string
  seconds: number
  refreshing: boolean
  /** Show divider above (e.g. after another block) */
  bordered?: boolean
  className?: string
}

export default function LiveRefreshHeader({
  title,
  subtitle = `Live prices · refreshes every ${LIVE_REFRESH_SEC}s`,
  seconds,
  refreshing,
  bordered = true,
  className,
}: LiveRefreshHeaderProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 mb-4',
        bordered && 'mt-6 pt-6 border-t border-zinc-800/60',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="section-label">{title}</h2>
        <p className="text-xs text-zinc-600 mt-1">{subtitle}</p>
      </div>
      <RefreshCountdown seconds={seconds} refreshing={refreshing} />
    </div>
  )
}
