import { fetchYahooStockResearchFromYahoo } from '@/lib/yahoo-research'
import {
  needsResearchRefresh,
  upsertResearchToDb,
  type StockResearchCacheRow,
} from '@/lib/stock-research-cache'
import { getYahooCrumbRetryAfterMs, YahooRateLimitedError } from '@/lib/yahoo-session'
import type { createServerClient } from '@/lib/supabase'

type Supabase = ReturnType<typeof createServerClient>

/** Tickers per hourly cron run — paced via Yahoo quoteSummary queue (~400ms gap). */
const BATCH_SIZE = 20

async function listResearchTickers(supabase: Supabase): Promise<string[]> {
  const tickers = new Set<string>()

  const sources = await Promise.all([
    supabase.from('watchlist_stocks').select('ticker'),
    supabase.from('portfolio_holdings').select('ticker'),
    supabase.from('stock_fundamentals').select('ticker'),
  ])

  for (const { data } of sources) {
    for (const row of data ?? []) {
      if (row.ticker) tickers.add(String(row.ticker).toUpperCase())
    }
  }

  return [...tickers].sort()
}

export type RefreshResearchResult = {
  tickers_total: number
  tickers_stale: number
  tickers_attempted: number
  research_updated: number
  rate_limited: boolean
  errors: string[]
}

/** Slowly refresh stale research rows — one Yahoo quoteSummary at a time. */
export async function refreshResearchInDb(supabase: Supabase): Promise<RefreshResearchResult> {
  const result: RefreshResearchResult = {
    tickers_total: 0,
    tickers_stale: 0,
    tickers_attempted: 0,
    research_updated: 0,
    rate_limited: false,
    errors: [],
  }

  const tickers = await listResearchTickers(supabase)
  result.tickers_total = tickers.length
  if (!tickers.length) return result

  const { data: rows } = await supabase.from('stock_research_cache').select('ticker, fetched_at').in('ticker', tickers)
  const fetchedAtByTicker = new Map<string, string>()
  for (const row of (rows ?? []) as Pick<StockResearchCacheRow, 'ticker' | 'fetched_at'>[]) {
    fetchedAtByTicker.set(row.ticker.toUpperCase(), row.fetched_at)
  }

  const stale = tickers
    .filter((t) => needsResearchRefresh(fetchedAtByTicker.get(t)))
    .sort((a, b) => {
      const aAt = fetchedAtByTicker.get(a)
      const bAt = fetchedAtByTicker.get(b)
      if (!aAt && !bAt) return a.localeCompare(b)
      if (!aAt) return -1
      if (!bAt) return 1
      return new Date(aAt).getTime() - new Date(bAt).getTime()
    })

  result.tickers_stale = stale.length
  const batch = stale.slice(0, BATCH_SIZE)
  result.tickers_attempted = batch.length

  const nowIso = new Date().toISOString()

  for (const sym of batch) {
    if (getYahooCrumbRetryAfterMs() > 0) {
      result.rate_limited = true
      break
    }

    try {
      const snapshot = await fetchYahooStockResearchFromYahoo(sym)
      if (!snapshot) {
        result.errors.push(`${sym}: yahoo returned no data`)
        continue
      }
      await upsertResearchToDb(supabase, snapshot, nowIso)
      result.research_updated++
    } catch (err) {
      if (err instanceof YahooRateLimitedError) {
        result.rate_limited = true
        break
      }
      result.errors.push(`${sym}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return result
}
