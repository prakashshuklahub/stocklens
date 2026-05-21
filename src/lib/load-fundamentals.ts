import {
  fundamentalsCacheCutoff,
  isFundamentalsCacheFresh,
  needsTargetRefresh,
} from '@/lib/fundamentals-cache'
import { fetchAnalystPriceTarget, fetchStockFundamentals } from '@/lib/fundamentals-fetch'
import { isUSMarketOpen } from '@/lib/market-hours'
import type { createServerClient } from '@/lib/supabase'
import type { StockFundamentals } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

export async function loadFundamentalsForTickers(
  supabase: Supabase,
  tickers: string[],
  options?: { upsert?: boolean },
): Promise<Record<string, StockFundamentals>> {
  const syms = [...new Set(tickers.map((t) => t.toUpperCase()))]
  if (!syms.length) return {}

  const cutoff = fundamentalsCacheCutoff()
  const { data: rows, error } = await supabase
    .from('stock_fundamentals')
    .select('*')
    .in('ticker', syms)

  const tableMissing = Boolean(
    error?.message?.includes('stock_fundamentals') || error?.message?.includes('PGRST205'),
  )

  const byTicker = new Map<string, StockFundamentals & { fetched_at?: string }>()
  for (const row of (rows ?? []) as (StockFundamentals & { fetched_at?: string })[]) {
    byTicker.set(row.ticker, row)
  }

  const shouldUpsert = options?.upsert !== false && !tableMissing
  const marketOpen = isUSMarketOpen()

  for (const sym of syms) {
    const cached = byTicker.get(sym)
    const freshCache = cached && isFundamentalsCacheFresh(cached, cutoff)

    if (freshCache && !needsTargetRefresh(cached)) continue

    // Outside regular session: keep cached fundamentals; only cold-start fetch if missing.
    if (!marketOpen && cached) continue

    let next: StockFundamentals

    if (freshCache && needsTargetRefresh(cached) && marketOpen) {
      const targets = await fetchAnalystPriceTarget(sym)
      if (targets?.target_mean) {
        next = { ...cached, ...targets }
      } else {
        continue
      }
    } else {
      next = await fetchStockFundamentals(sym)
    }

    byTicker.set(sym, next)

    if (shouldUpsert) {
      await supabase
        .from('stock_fundamentals')
        .upsert({ ...next, fetched_at: new Date().toISOString() }, { onConflict: 'ticker' })
    }
  }

  const out: Record<string, StockFundamentals> = {}
  for (const sym of syms) {
    const row = byTicker.get(sym)
    if (row) out[sym] = row
  }
  return out
}
