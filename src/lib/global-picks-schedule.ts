/** Global picks cron: 17:00 UTC Mon–Fri (10:30pm IST) — after targets + research crons. */

export const GLOBAL_PICKS_CRON_UTC = { hour: 17, minute: 0, weekday: '1-5' } as const

export function usTradingDateString(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Next weekday 17:00 UTC after `from`. */
export function nextGlobalPicksRefreshAt(from = new Date()): string {
  const d = new Date(from)
  d.setUTCSeconds(0, 0)
  for (let i = 0; i < 8; i++) {
    const day = d.getUTCDay()
    const isWeekday = day >= 1 && day <= 5
    const candidate = new Date(d)
    candidate.setUTCHours(GLOBAL_PICKS_CRON_UTC.hour, GLOBAL_PICKS_CRON_UTC.minute, 0, 0)
    if (isWeekday && candidate.getTime() > from.getTime()) {
      return candidate.toISOString()
    }
    d.setUTCDate(d.getUTCDate() + 1)
    d.setUTCHours(0, 0, 0, 0)
  }
  const fallback = new Date(from)
  fallback.setUTCDate(fallback.getUTCDate() + 1)
  fallback.setUTCHours(GLOBAL_PICKS_CRON_UTC.hour, GLOBAL_PICKS_CRON_UTC.minute, 0, 0)
  return fallback.toISOString()
}
