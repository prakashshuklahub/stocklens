import { fetchNewsForTicker, type RawNewsItem } from '@/lib/news'
import type { SignalNewsItem } from '@/types'

export const PICK_HEADLINES_LIMIT = 3
const HEADLINE_CACHE_TTL_MS = 15 * 60 * 1000

const headlineCache = new Map<string, { at: number; items: SignalNewsItem[] }>()

/** Latest first; stronger sentiment wins when timestamps are close. */
export function sortPickHeadlines(items: RawNewsItem[]): RawNewsItem[] {
  return [...items].sort((a, b) => {
    const ageDiff = new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    if (ageDiff !== 0) return ageDiff
    return Math.abs(b.sentiment_score) - Math.abs(a.sentiment_score)
  })
}

export function toSignalNewsItems(items: RawNewsItem[], limit = PICK_HEADLINES_LIMIT): SignalNewsItem[] {
  return sortPickHeadlines(items).slice(0, limit).map((n) => ({
    title: n.title,
    url: n.url,
    source: n.source,
    published_at: n.published_at,
    sentiment: n.sentiment,
  }))
}

async function headlinesForTicker(ticker: string): Promise<SignalNewsItem[]> {
  const key = ticker.toUpperCase()
  const hit = headlineCache.get(key)
  if (hit && Date.now() - hit.at < HEADLINE_CACHE_TTL_MS) return hit.items

  const raw = await fetchNewsForTicker(key)
  const items = toSignalNewsItems(raw)
  headlineCache.set(key, { at: Date.now(), items })
  return items
}

export async function fetchPickHeadlinesForTickers(
  tickers: string[],
): Promise<Map<string, SignalNewsItem[]>> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))]
  const result = new Map<string, SignalNewsItem[]>()
  if (!unique.length) return result

  const newsResults = await Promise.all(unique.map((ticker) => headlinesForTicker(ticker)))
  unique.forEach((ticker, i) => {
    result.set(ticker, newsResults[i] ?? [])
  })

  return result
}
