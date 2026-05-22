'use client'

import {
  getUSMarketSession,
  isPriceRefreshActive,
  type MarketSession,
} from '@/lib/market-hours'
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

/** True during pre-market, regular, or after-hours — enables live price refresh. */
export function useMarketOpen(): boolean {
  const [active, setActive] = useState(() => isPriceRefreshActive())

  useEffect(() => {
    const tick = () => setActive(isPriceRefreshActive())
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  return active
}
