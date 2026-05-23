import { needsTargetRefresh } from '@/lib/fundamentals-cache'
import { fetchAndResolveTarget, mapPool } from '@/lib/fundamentals-fetch'
import type { createServerClient } from '@/lib/supabase'
import type { StockFundamentals } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

const BATCH_SIZE = 40
const CONCURRENCY = 3

async function listTickers(supabase: Supabase): Promise<string[]> {
  const tickers = new Set<string>()

  const { data: watchlist } = await supabase.from('watchlist_stocks').select('ticker')
  for (const row of watchlist ?? []) {
    if (row.ticker) tickers.add(String(row.ticker).toUpperCase())
  }

  const { data: fundamentals } = await supabase.from('stock_fundamentals').select('ticker')
  for (const row of fundamentals ?? []) {
    if (row.ticker) tickers.add(String(row.ticker).toUpperCase())
  }

  return [...tickers].sort()
}

export type RefreshTargetsResult = {
  tickers_total: number
  tickers_attempted: number
  targets_updated: number
  forced: boolean
  errors: string[]
}

/** Bulk target refresh → stock_fundamentals (StockAnalysis first in chain). */
export async function refreshTargetsInDb(
  supabase: Supabase,
  options?: { force?: boolean },
): Promise<RefreshTargetsResult> {
  const forced = options?.force === true
  const tickers = await listTickers(supabase)
  const result: RefreshTargetsResult = {
    tickers_total: tickers.length,
    tickers_attempted: 0,
    targets_updated: 0,
    forced,
    errors: [],
  }

  if (!tickers.length) return result

  const { data: rows } = await supabase.from('stock_fundamentals').select('*').in('ticker', tickers)
  const byTicker = new Map<string, StockFundamentals & { fetched_at?: string }>()
  for (const row of (rows ?? []) as (StockFundamentals & { fetched_at?: string })[]) {
    byTicker.set(row.ticker, row)
  }

  const toRefresh = forced
    ? tickers
    : tickers.filter((t) => {
        const row = byTicker.get(t)
        return !row || needsTargetRefresh(row)
      })

  const batch = toRefresh.slice(0, BATCH_SIZE)
  result.tickers_attempted = batch.length
  const nowIso = new Date().toISOString()

  await mapPool(batch, CONCURRENCY, async (sym) => {
    try {
      const prev = byTicker.get(sym)
      const week52 = prev?.week52_high ?? null
      const targetFields = await fetchAndResolveTarget(sym, week52)
      const merged: StockFundamentals = {
        ...(prev ?? {
          ticker: sym,
          change_7d_pct: null,
          change_14d_pct: null,
          change_30d_pct: null,
          week52_high: null,
          week52_low: null,
          target_mean: null,
          target_high: null,
          target_low: null,
          target_price: null,
          target_source: null,
          target_fetched_at: null,
          analyst_buy: null,
          analyst_hold: null,
          analyst_sell: null,
          news_sentiment: null,
          news_count_7d: null,
          support_5d: null,
          support_20d: null,
          avg_20d: null,
          volume_ratio: null,
        }),
        ...targetFields,
      }

      const { error } = await supabase.from('stock_fundamentals').upsert(
        { ...merged, fetched_at: prev?.fetched_at ?? nowIso },
        { onConflict: 'ticker' },
      )

      if (error) {
        result.errors.push(`${sym}: ${error.message}`)
        return
      }

      result.targets_updated++
    } catch (err) {
      result.errors.push(`${sym}: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  return result
}
