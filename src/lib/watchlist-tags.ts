/** User-defined watchlist tag validation and normalization. */

export const WATCHLIST_TAG_MAX_LENGTH = 24
export const WATCHLIST_MAX_TAGS_PER_STOCK = 5
export const WATCHLIST_MAX_TAGS_PER_USER = 30

export const WATCHLIST_TAG_HINTS = ['Long term', 'Short term', 'Dividend', 'Swing', 'Theme'] as const

const TAG_NAME_PATTERN = /^[\p{L}\p{N}\s-]+$/u

export type WatchlistTagRef = {
  id: string
  name: string
}

export function normalizeWatchlistTagName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ')
}

export function normalizeWatchlistTagKey(name: string): string {
  return normalizeWatchlistTagName(name).toLowerCase()
}

export function validateWatchlistTagName(raw: string): { ok: true; name: string } | { ok: false; error: string } {
  const name = normalizeWatchlistTagName(raw)
  if (!name) return { ok: false, error: 'Tag name cannot be empty' }
  if (name.length > WATCHLIST_TAG_MAX_LENGTH) {
    return { ok: false, error: `Tag name must be ${WATCHLIST_TAG_MAX_LENGTH} characters or less` }
  }
  if (!TAG_NAME_PATTERN.test(name)) {
    return { ok: false, error: 'Use letters, numbers, spaces, or hyphens only' }
  }
  return { ok: true, name }
}

/** Dedupe tag names case-insensitively while preserving first-seen casing. */
export function dedupeWatchlistTagNames(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const parsed = validateWatchlistTagName(raw)
    if (!parsed.ok) continue
    const key = normalizeWatchlistTagKey(parsed.name)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(parsed.name)
  }
  return out
}

export function validateWatchlistTagList(names: string[]): { ok: true; names: string[] } | { ok: false; error: string } {
  if (names.length > WATCHLIST_MAX_TAGS_PER_STOCK) {
    return { ok: false, error: `At most ${WATCHLIST_MAX_TAGS_PER_STOCK} tags per stock` }
  }

  const deduped: string[] = []
  const seen = new Set<string>()

  for (const raw of names) {
    const parsed = validateWatchlistTagName(raw)
    if (!parsed.ok) return parsed
    const key = normalizeWatchlistTagKey(parsed.name)
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(parsed.name)
  }

  return { ok: true, names: deduped }
}
