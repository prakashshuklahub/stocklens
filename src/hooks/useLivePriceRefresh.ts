'use client'

import { LIVE_REFRESH_SEC } from '@/components/LiveRefreshHeader'
import { useEffect, useState } from 'react'

/** 13s countdown + fetch while enabled (regular market hours only). Default interval for watchlist. */
export function useLivePriceRefresh(
  enabled: boolean,
  onRefresh: () => void,
  intervalSec = LIVE_REFRESH_SEC,
) {
  const [countdown, setCountdown] = useState(intervalSec)

  useEffect(() => {
    if (!enabled) {
      setCountdown(intervalSec)
      return
    }

    let secs = intervalSec
    setCountdown(secs)
    const tick = setInterval(() => {
      secs -= 1
      if (secs <= 0) {
        onRefresh()
        secs = intervalSec
      }
      setCountdown(secs)
    }, 1000)
    return () => clearInterval(tick)
  }, [enabled, onRefresh, intervalSec])

  return countdown
}
