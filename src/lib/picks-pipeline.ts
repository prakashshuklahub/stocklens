/** Shared helpers for /api/picks routes. */

export const PICKS_NO_CACHE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const

export function latestIso(dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => Boolean(d))
  if (!valid.length) return null
  return valid.reduce((a, b) => (a > b ? a : b))
}
