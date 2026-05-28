/** US equities session windows (NYSE/Nasdaq, Eastern). */

export const US_MARKET_TZ = 'America/New_York'

/** Regular cash session vs closed — no pre-market / after-hours handling. */
export type MarketSession = 'regular' | 'closed'

/** Suggestions polling interval during market hours only. */
export const PRICE_REFRESH_MS = 120_000

const OPEN_MINUTES = 9 * 60 + 30
const CLOSE_MINUTES = 16 * 60

/** WhatsApp daily briefing: 1 hour after US cash open (10:30 AM ET). */
const WHATSAPP_BRIEFING_MINUTES_AFTER_OPEN = 60
const WHATSAPP_SEND_WINDOW_MINUTES = 30

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

/** Mon–Fri on the US Eastern calendar. */
export function isUSMarketWeekday(now = new Date()): boolean {
  const { weekday } = easternClock(now)
  return weekday !== 'Sat' && weekday !== 'Sun'
}

/** True during regular US cash session only (9:30 AM–4:00 PM ET, weekdays). */
export function isUSMarketOpen(now = new Date()): boolean {
  const { weekday, minutes } = easternClock(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  return minutes >= OPEN_MINUTES && minutes < CLOSE_MINUTES
}

/** 10:30 AM ET — one hour after US market open. */
export function whatsAppBriefingSendMinutes(): number {
  return OPEN_MINUTES + WHATSAPP_BRIEFING_MINUTES_AFTER_OPEN
}

/**
 * Mon–Fri, 10:30–11:00 AM ET — daily WhatsApp send window (cron may fire slightly early/late).
 */
export function isWhatsAppBriefingSendWindow(now = new Date()): boolean {
  if (!isUSMarketWeekday(now)) return false
  const { minutes } = easternClock(now)
  const start = whatsAppBriefingSendMinutes()
  return minutes >= start && minutes < start + WHATSAPP_SEND_WINDOW_MINUTES
}

/** Start of the current US Eastern calendar day (for once-per-trading-day dedupe). */
export function startOfUSEasternDayIso(now = new Date()): string {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: US_MARKET_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)

  const anchor = new Date(`${ymd}T12:00:00.000Z`)
  const scanStart = anchor.getTime() - 24 * 3600_000

  for (let i = 0; i <= 48; i++) {
    const probe = new Date(scanStart + i * 3600_000)
    const probeYmd = new Intl.DateTimeFormat('en-CA', {
      timeZone: US_MARKET_TZ,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(probe)
    if (probeYmd !== ymd) continue

    const parts = easternClock(probe)
    if (parts.minutes === 0) return probe.toISOString()
  }

  return new Date(`${ymd}T05:00:00.000Z`).toISOString()
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
