'use client'

import { createContext, useContext, type ReactNode } from 'react'

export type PicksRefreshContextValue = {
  refresh: () => Promise<void>
  refreshing: boolean
}

const PicksRefreshContext = createContext<PicksRefreshContextValue | null>(null)

export function PicksRefreshProvider({
  value,
  children,
}: {
  value: PicksRefreshContextValue
  children: ReactNode
}) {
  return <PicksRefreshContext.Provider value={value}>{children}</PicksRefreshContext.Provider>
}

export function usePicksRefresh(): PicksRefreshContextValue | null {
  return useContext(PicksRefreshContext)
}
