/** Scheduled / background job window — IST off-hours to reduce API + Gemini spend. */

export const CRON_WINDOW_TZ = 'Asia/Kolkata'

const OFF_HOURS_START_MINUTES = 3 * 60
const OFF_HOURS_END_MINUTES = 15 * 60

export type CronWindowSkipReason = 'weekend' | 'off_hours'

export type CronWindowStatus =
  | { allowed: true }
  | { allowed: false; reason: CronWindowSkipReason }

function istClock(now: Date): { weekday: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CRON_WINDOW_TZ,
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

/**
 * Allowed: Mon–Fri from 3:00pm IST until 3:00am IST next calendar day.
 * Blocked: Mon–Fri 3:00am–2:59pm IST; all day Saturday and Sunday.
 */
export function getCronWindowStatus(now = new Date()): CronWindowStatus {
  const { weekday, minutes } = istClock(now)

  if (weekday === 'Sat' || weekday === 'Sun') {
    return { allowed: false, reason: 'weekend' }
  }

  if (minutes >= OFF_HOURS_START_MINUTES && minutes < OFF_HOURS_END_MINUTES) {
    return { allowed: false, reason: 'off_hours' }
  }

  return { allowed: true }
}

export function isCronWorkAllowed(now = new Date()): boolean {
  return getCronWindowStatus(now).allowed
}

/** Mon–Fri in Asia/Kolkata (for WhatsApp weekday sends). */
export function isIstWeekday(now = new Date()): boolean {
  const { weekday } = istClock(now)
  return weekday !== 'Sat' && weekday !== 'Sun'
}

export function cronWindowSkipMessage(status: Extract<CronWindowStatus, { allowed: false }>): string {
  if (status.reason === 'weekend') {
    return 'Skipped — weekend (IST). Scheduled jobs run Mon–Fri from 3:00pm IST.'
  }
  return 'Skipped — off hours (IST 3:00am–3:00pm). Scheduled jobs run from 3:00pm IST.'
}

export function logCronWindowSkip(context: string, status: Extract<CronWindowStatus, { allowed: false }>): void {
  console.info(`[${context}] ${cronWindowSkipMessage(status)}`)
}
