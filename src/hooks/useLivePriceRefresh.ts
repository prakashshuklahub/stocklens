'use client'

import { LIVE_REFRESH_SEC } from '@/components/LiveRefreshHeader'
import { useEffect, useState } from 'react'

/** 13s countdown + fetch every 13s while enabled (regular market hours only). */
export function useLivePriceRefresh(enabled: boolean, onRefresh: () => void) {
  const [countdown, setCountdown] = useState(LIVE_REFRESH_SEC)

  useEffect(() => {
    if (!enabled) {
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
  }, [enabled, onRefresh])

  return countdown
}
