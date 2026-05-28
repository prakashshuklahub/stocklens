/** US equities session windows (NYSE/Nasdaq, Eastern). */

export const US_MARKET_TZ = 'America/New_York'

/** Regular cash session vs closed — no pre-market / after-hours handling. */
export type MarketSession = 'regular' | 'closed'

/** Suggestions polling interval during market hours only. */
export const PRICE_REFRESH_MS = 120_000

const OPEN_MINUTES = 9 * 60 + 30
const CLOSE_MINUTES = 16 * 60

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

/** True during regular US cash session only (9:30 AM–4:00 PM ET, weekdays). */
export function isUSMarketOpen(now = new Date()): boolean {
  const { weekday, minutes } = easternClock(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES
}

/** Clock session for UI badges and vs-sector labels. */
export function getUSMarketSession(now = new Date()): MarketSession {
  return isUSMarketOpen(now) ? 'regular' : 'closed'
}

/** Live price polling + force refresh — regular session only. */
export function isPriceRefreshActive(now = new Date()): boolean {
  return isUSMarketOpen(now)
}

export function sessionPriceLabel(session: MarketSession): string | null {
  return session === 'closed' ? 'Closed' : null
}

/** Show Closed badge when snapshot or clock is outside regular session. */
export function priceBadgeSession(
  snapshotSession: MarketSession | undefined,
  clockSession: MarketSession,
): MarketSession | undefined {
  if (snapshotSession === 'closed' || clockSession === 'closed') return 'closed'
  return undefined
}

export function liveRefreshSubtitle(session: MarketSession): string {
  return session === 'regular'
    ? 'Live prices · refreshes every 13s'
    : 'Prices from the last regular session'
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
