/** US equities regular session (NYSE/Nasdaq): Mon–Fri 9:30–16:00 Eastern. */

export const US_MARKET_TZ = 'America/New_York'

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

/** True during regular US cash session (not pre/post market). */
export function isUSMarketOpen(now = new Date()): boolean {
  const { weekday, minutes } = easternClock(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES
}

export function liveRefreshSubtitle(intervalSec: number, marketOpen: boolean): string {
  if (marketOpen) {
    return `Live prices · refreshes every ${intervalSec}s while market is open`
  }
  return 'Prices from the last regular session'
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
