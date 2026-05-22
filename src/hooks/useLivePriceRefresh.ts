'use client'

import { LIVE_REFRESH_SEC } from '@/components/LiveRefreshHeader'
import { PRICE_REFRESH_MS, type MarketSession } from '@/lib/market-hours'
import { useBackgroundPriceRefresh } from '@/hooks/useBackgroundPriceRefresh'
import { useEffect, useState } from 'react'

/**
 * Regular session: 15s countdown bar + fetch every 15s.
 * Pre/post: silent 2 min background refresh, no bar.
 */
export function useLivePriceRefresh(
  session: MarketSession,
  enabled: boolean,
  onRefresh: () => void,
) {
  const isRegular = session === 'regular'
  const [countdown, setCountdown] = useState(LIVE_REFRESH_SEC)

  useBackgroundPriceRefresh(enabled && !isRegular, onRefresh, PRICE_REFRESH_MS)

  useEffect(() => {
    if (!enabled || !isRegular) {
      setCountdown(LIVE_REFRESH_SEC)
      return
    }

    let secs = LIVE_REFRESH_SEC
    setCountdown(secs)
    const tick = setInterval(() => {
      secs -= 1
      if (secs <= 0) {
        onRefresh()
        secs = LIVE_REFRESH_SEC
      }
      setCountdown(secs)
    }, 1000)
    return () => clearInterval(tick)
  }, [enabled, isRegular, onRefresh])

  return countdown
}
