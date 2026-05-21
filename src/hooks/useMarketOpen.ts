'use client'

import { isUSMarketOpen } from '@/lib/market-hours'
import { useEffect, useState } from 'react'

/** Re-check every 30s so the UI opens/closes with the session without reload. */
export function useMarketOpen(): boolean {
  const [open, setOpen] = useState(() => isUSMarketOpen())

  useEffect(() => {
    const tick = () => setOpen(isUSMarketOpen())
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  return open
}
