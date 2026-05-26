import { fetchNewsForTicker, type RawNewsItem } from '@/lib/news'
import type { SignalNewsItem } from '@/types'

/** Headlines shown per stock on watchlist cards and picks. */
export const HEADLINES_LIMIT = 5
/** @deprecated Use HEADLINES_LIMIT */
export const PICK_HEADLINES_LIMIT = HEADLINES_LIMIT

const HEADLINE_CACHE_TTL_MS = 15 * 60 * 1000

const headlineCache = new Map<string, { at: number; items: SignalNewsItem[] }>()

export interface HeadlineFetchOptions {
  limit?: number
  companyName?: string | null
}

/** Relevance-first, then recency, then sentiment strength. */
export function sortPickHeadlines(items: RawNewsItem[]): RawNewsItem[] {
  return [...items].sort((a, b) => {
    const rel = (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
    if (rel !== 0) return rel
    const ageDiff = new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    if (ageDiff !== 0) return ageDiff
    return Math.abs(b.sentiment_score) - Math.abs(a.sentiment_score)
  })
}

export function toSignalNewsItems(items: RawNewsItem[], limit = HEADLINES_LIMIT): SignalNewsItem[] {
  return sortPickHeadlines(items).slice(0, limit).map((n) => ({
    title: n.title,
    url: n.url,
    source: n.source,
    published_at: n.published_at,
    sentiment: n.sentiment,
  }))
}

function cacheKey(ticker: string, companyName?: string | null): string {
  const name = companyName?.trim().toLowerCase() ?? ''
  return `${ticker.toUpperCase()}|${name}`
}

async function headlinesForTicker(
  ticker: string,
  options: HeadlineFetchOptions = {},
): Promise<SignalNewsItem[]> {
  const limit = options.limit ?? HEADLINES_LIMIT
  const key = cacheKey(ticker, options.companyName)
  const hit = headlineCache.get(key)
  if (hit && Date.now() - hit.at < HEADLINE_CACHE_TTL_MS) return hit.items

  const raw = await fetchNewsForTicker(ticker, { companyName: options.companyName })
  const items = toSignalNewsItems(raw, limit)
  headlineCache.set(key, { at: Date.now(), items })
  return items
}

export async function fetchHeadlinesForTickers(
  tickers: string[],
  options: HeadlineFetchOptions & {
    companyNameByTicker?: Record<string, string | null | undefined>
  } = {},
): Promise<Map<string, SignalNewsItem[]>> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))]
  const result = new Map<string, SignalNewsItem[]>()
  if (!unique.length) return result

  const names = options.companyNameByTicker ?? {}
  const newsResults = await Promise.all(
    unique.map((ticker) =>
      headlinesForTicker(ticker, {
        limit: options.limit,
        companyName: names[ticker] ?? names[ticker.toUpperCase()],
      }),
    ),
  )
  unique.forEach((ticker, i) => {
    result.set(ticker, newsResults[i] ?? [])
  })

  return result
}

/** @deprecated Use fetchHeadlinesForTickers */
export async function fetchPickHeadlinesForTickers(
  tickers: string[],
): Promise<Map<string, SignalNewsItem[]>> {
  return fetchHeadlinesForTickers(tickers)
}
