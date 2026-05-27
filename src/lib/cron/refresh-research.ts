import { fetchStockResearchFromApis } from '@/lib/research-fetch'
import {
  listResearchTickerUniverse,
  needsResearchRefresh,
  sortResearchRefreshQueue,
  upsertResearchToDb,
  type StockResearchCacheRow,
} from '@/lib/stock-research-cache'
import type { createServerClient } from '@/lib/supabase'

type Supabase = ReturnType<typeof createServerClient>

/** Finnhub ~60/min — 30 tickers/hour with headroom. */
const BATCH_SIZE = 30
const TICKER_GAP_MS = 300

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export type RefreshResearchResult = {
  tickers_total: number
  watchlist_total: number
  tickers_stale: number
  tickers_attempted: number
  research_updated: number
  errors: string[]
}

/** Hourly: slowly refresh stale rows — watchlist missing rows first (all users). */
export async function refreshResearchInDb(supabase: Supabase): Promise<RefreshResearchResult> {
  const result: RefreshResearchResult = {
    tickers_total: 0,
    watchlist_total: 0,
    tickers_stale: 0,
    tickers_attempted: 0,
    research_updated: 0,
    errors: [],
  }

  const { watchlist, all: tickers } = await listResearchTickerUniverse(supabase)
  result.tickers_total = tickers.length
  result.watchlist_total = watchlist.size
  if (!tickers.length) return result

  const { data: rows } = await supabase.from('stock_research_cache').select('ticker, fetched_at').in('ticker', tickers)
  const fetchedAtByTicker = new Map<string, string>()
  for (const row of (rows ?? []) as Pick<StockResearchCacheRow, 'ticker' | 'fetched_at'>[]) {
    fetchedAtByTicker.set(row.ticker.toUpperCase(), row.fetched_at)
  }

  const stale = sortResearchRefreshQueue(tickers, watchlist, fetchedAtByTicker)
  result.tickers_stale = stale.length
  const batch = stale.slice(0, BATCH_SIZE)
  result.tickers_attempted = batch.length

  const nowIso = new Date().toISOString()

  for (let i = 0; i < batch.length; i++) {
    const sym = batch[i]
    try {
      const snapshot = await fetchStockResearchFromApis(sym)
      if (!snapshot) {
        result.errors.push(`${sym}: no data from Finnhub/FMP`)
        continue
      }
      await upsertResearchToDb(supabase, snapshot, nowIso)
      result.research_updated++
    } catch (err) {
      result.errors.push(`${sym}: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (i < batch.length - 1) await sleep(TICKER_GAP_MS)
  }

  return result
}
