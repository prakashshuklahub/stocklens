'use client'

import { PRICE_REFRESH_MS } from '@/lib/market-hours'
import { useEffect } from 'react'

/** Poll prices in the background — no visible countdown. */
export function useBackgroundPriceRefresh(
  active: boolean,
  onRefresh: () => void,
  intervalMs = PRICE_REFRESH_MS,
) {
  useEffect(() => {
    if (!active) return
    const id = setInterval(onRefresh, intervalMs)
    return () => clearInterval(id)
  }, [active, onRefresh, intervalMs])
}
