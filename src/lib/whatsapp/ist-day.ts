/** IST calendar helpers for WhatsApp dedupe and display. */

export const WHATSAPP_TZ = 'Asia/Kolkata'

/** ISO timestamp for 00:00:00 on the current IST calendar day. */
export function startOfIstDayIso(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: WHATSAPP_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)

  const year = parts.find((p) => p.type === 'year')?.value ?? '1970'
  const month = parts.find((p) => p.type === 'month')?.value ?? '01'
  const day = parts.find((p) => p.type === 'day')?.value ?? '01'
  return `${year}-${month}-${day}T00:00:00+05:30`
}

export function formatIstShortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: WHATSAPP_TZ,
    day: 'numeric',
    month: 'short',
  }).format(new Date(iso))
}

export function formatLastSentIst(iso: string): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: WHATSAPP_TZ,
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(iso))
}
