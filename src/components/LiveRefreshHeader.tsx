'use client'

import { RefreshCw } from 'lucide-react'
import { liveRefreshSubtitle, type MarketSession } from '@/lib/market-hours'
import { cn } from '@/lib/utils'

/** Picks LLM polling — watchlist/portfolio use PRICE_REFRESH_MS instead. */
export const LIVE_REFRESH_SEC = 15

interface LiveRefreshHeaderProps {
  title: string
  subtitle?: string
  refreshing?: boolean
  session?: MarketSession
  bordered?: boolean
  className?: string
  footer?: React.ReactNode
}

export default function LiveRefreshHeader({
  title,
  subtitle,
  refreshing = false,
  session = 'regular',
  bordered = true,
  className,
  footer,
}: LiveRefreshHeaderProps) {
  const priceLive = session !== 'closed'

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 mb-3',
        bordered && 'mt-6 pt-6 border-t border-zinc-800/60',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="section-label">{title}</h2>
        <p className="text-xs text-zinc-600 mt-1" aria-live="polite">
          {refreshing && priceLive ? (
            <span className="inline-flex items-center gap-1">
              <RefreshCw className="w-3 h-3 animate-spin" aria-hidden="true" />
              Updating prices…
            </span>
          ) : (
            subtitle ?? liveRefreshSubtitle(session)
          )}
        </p>
        {footer}
      </div>
    </div>
  )
}
