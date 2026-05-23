'use client'

import { RefreshCw } from 'lucide-react'
import { liveRefreshSubtitle, type MarketSession } from '@/lib/market-hours'
import { cn } from '@/lib/utils'

/** Live session price polling — pre/post use PRICE_REFRESH_MS without a bar. */
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
      aria-label={
        refreshing
          ? 'Updating live prices'
          : `Live prices refresh in ${seconds} seconds`
      }
    >
      <div className="w-14 h-1 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={cn(
            'h-full rounded-full bg-blue-500/60 transition-all duration-1000 ease-linear',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="type-caption tabular-nums text-zinc-500 min-w-[2.5rem] text-right">
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
  seconds?: number
  refreshing?: boolean
  session?: MarketSession
  bordered?: boolean
  className?: string
  footer?: React.ReactNode
}

export default function LiveRefreshHeader({
  title,
  subtitle,
  seconds = LIVE_REFRESH_SEC,
  refreshing = false,
  session = 'regular',
  bordered = true,
  className,
  footer,
}: LiveRefreshHeaderProps) {
  const isLive = session === 'regular'

  return (
    <div
      className={cn(
        'mb-3',
        bordered && 'mt-6 pt-6 border-t border-zinc-800/60',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="section-label">{title}</h2>
          <p className="type-caption text-zinc-600 mt-1" aria-live="polite">
            {subtitle ?? liveRefreshSubtitle(session)}
          </p>
        </div>
        {isLive && (
          <RefreshCountdown seconds={seconds} refreshing={!!refreshing} />
        )}
      </div>
      {footer}
    </div>
  )
}
