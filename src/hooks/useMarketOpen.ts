'use client'

import { getUSMarketSession, isUSMarketOpen, type MarketSession } from '@/lib/market-hours'
import { useEffect, useState } from 'react'

/** Re-check every 30s so the UI tracks session changes without reload. */
export function useMarketSession(): MarketSession {
  const [session, setSession] = useState<MarketSession>(() => getUSMarketSession())

  useEffect(() => {
    const tick = () => setSession(getUSMarketSession())
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  return session
}

/** True during regular market hours — enables 13s live price refresh. */
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
