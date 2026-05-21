import {
  fundamentalsCacheCutoff,
  isFundamentalsCacheFresh,
  needsTargetRefresh,
} from '@/lib/fundamentals-cache'
import {
  fetchAndResolveTarget,
  fetchStockFundamentals,
  fetchStockPriceData,
} from '@/lib/fundamentals-fetch'
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
  const nowIso = new Date().toISOString()

  for (const sym of syms) {
    const cached = byTicker.get(sym)
    const priceFresh = cached && isFundamentalsCacheFresh(cached, cutoff)
    const targetFresh = cached && !needsTargetRefresh(cached)

    if (priceFresh && targetFresh) continue

    // Target-only refresh — runs any time (including after 5pm when market is closed)
    if (priceFresh && !targetFresh) {
      const targetFields = await fetchAndResolveTarget(sym, cached!.week52_high ?? null)
      const next: StockFundamentals = { ...cached!, ...targetFields }
      byTicker.set(sym, next)
      if (shouldUpsert) {
        await supabase
          .from('stock_fundamentals')
          .upsert({ ...next, fetched_at: cached!.fetched_at ?? nowIso }, { onConflict: 'ticker' })
      }
      continue
    }

    // Outside regular session: keep stale price data but still allow target refresh above
    if (!marketOpen && cached && !priceFresh) {
      if (!targetFresh) {
        const targetFields = await fetchAndResolveTarget(sym, cached.week52_high ?? null)
        const next: StockFundamentals = { ...cached, ...targetFields }
        byTicker.set(sym, next)
        if (shouldUpsert) {
          await supabase
            .from('stock_fundamentals')
            .upsert({ ...next, fetched_at: cached.fetched_at ?? nowIso }, { onConflict: 'ticker' })
        }
      }
      continue
    }

    let next: StockFundamentals

    if (!cached) {
      next = await fetchStockFundamentals(sym)
    } else if (!priceFresh) {
      const priceData = await fetchStockPriceData(sym)
      next = {
        ...cached,
        ...priceData,
        fetched_at: nowIso,
      } as StockFundamentals & { fetched_at?: string }

      if (!targetFresh) {
        const targetFields = await fetchAndResolveTarget(sym, next.week52_high ?? null)
        next = { ...next, ...targetFields }
      }
    } else {
      continue
    }

    byTicker.set(sym, next)

    if (shouldUpsert) {
      await supabase
        .from('stock_fundamentals')
        .upsert({ ...next, fetched_at: (next as { fetched_at?: string }).fetched_at ?? nowIso }, { onConflict: 'ticker' })
    }
  }

  const out: Record<string, StockFundamentals> = {}
  for (const sym of syms) {
    const row = byTicker.get(sym)
    if (row) out[sym] = row
  }
  return out
}
