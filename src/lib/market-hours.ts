/** US equities session windows (NYSE/Nasdaq, Eastern). */

export const US_MARKET_TZ = 'America/New_York'

export type MarketSession = 'pre' | 'regular' | 'post' | 'closed'

/** Background price polling for watchlist & portfolio (no countdown in UI). */
export const PRICE_REFRESH_MS = 120_000

const PRE_START = 4 * 60 // 4:00 AM ET
const OPEN_MINUTES = 9 * 60 + 30
const CLOSE_MINUTES = 16 * 60
const POST_END = 20 * 60 // 8:00 PM ET

function easternClock(now: Date): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: US_MARKET_TZ,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now)

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
  return { weekday, minutes: hour * 60 + minute }
}

/** Clock-based session (client refresh windows). Yahoo `marketState` drives actual prices. */
export function getUSMarketSession(now = new Date()): MarketSession {
  const { weekday, minutes } = easternClock(now)
  if (weekday === 'Sat' || weekday === 'Sun') return 'closed'
  if (minutes >= PRE_START && minutes < OPEN_MINUTES) return 'pre'
  if (minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES) return 'regular'
  if (minutes >= CLOSE_MINUTES && minutes < POST_END) return 'post'
  return 'closed'
}

/** Pre, regular, or after-hours — enable live price polling. */
export function isPriceRefreshActive(now = new Date()): boolean {
  return getUSMarketSession(now) !== 'closed'
}

/** True during regular US cash session only (9:30 AM–4:00 PM ET). */
export function isUSMarketOpen(now = new Date()): boolean {
  return getUSMarketSession(now) === 'regular'
}

export function sessionPriceLabel(session: MarketSession): string | null {
  switch (session) {
    case 'pre':
      return 'Pre-market'
    case 'post':
      return 'After-hours'
    case 'closed':
      return 'Closed'
    default:
      return null
  }
}

/** Badge session — Yahoo snapshot first, client clock fallback for extended/closed. */
export function priceBadgeSession(
  snapshotSession: MarketSession | undefined,
  clockSession: MarketSession,
): MarketSession | undefined {
  if (snapshotSession && snapshotSession !== 'regular') return snapshotSession
  if (clockSession !== 'regular') return clockSession
  return undefined
}

export function liveRefreshSubtitle(session: MarketSession): string {
  switch (session) {
    case 'regular':
      return 'Live prices'
    case 'pre':
      return 'Pre-market prices'
    case 'post':
      return 'After-hours prices'
    default:
      return 'Prices from the last regular session'
  }
}

/** Format snapshot timestamp for display (e.g. "May 20, 4:00 PM ET"). */
export function formatSnapshotAsOfET(asOfMs: number | null | undefined): string | null {
  if (asOfMs == null) return null
  const formatted = new Intl.DateTimeFormat('en-US', {
    timeZone: US_MARKET_TZ,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(asOfMs))
  return `${formatted} ET`
}
