import {
  fundamentalsCacheCutoff,
  isFundamentalsCacheFresh,
  needsTargetRefresh,
} from '@/lib/fundamentals-cache'
import {
  fetchAndResolveTarget,
  fetchStockFundamentals,
  fetchStockPriceData,
  mapPool,
} from '@/lib/fundamentals-fetch'
import { isUSMarketOpen } from '@/lib/market-hours'
import type { createServerClient } from '@/lib/supabase'
import type { StockFundamentals } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

export const FUNDAMENTALS_REFRESH_CONCURRENCY = 3

type RefreshContext = {
  shouldUpsert: boolean
  marketOpen: boolean
  cutoff: string
  nowIso: string
}

async function upsertFundamentals(
  supabase: Supabase,
  row: StockFundamentals & { fetched_at?: string },
  fetchedAt: string,
): Promise<void> {
  const { error } = await supabase
    .from('stock_fundamentals')
    .upsert({ ...row, fetched_at: row.fetched_at ?? fetchedAt }, { onConflict: 'ticker' })

  if (error) {
    console.error(
      `[fundamentals] upsert failed ${row.ticker}:`,
      error.message,
      row.target_source ? `target_source=${row.target_source}` : '',
    )
  }
}

function needsAnyRefresh(
  cached: StockFundamentals | undefined,
  ctx: Pick<RefreshContext, 'cutoff' | 'marketOpen'>,
): boolean {
  if (!cached) return true
  const priceFresh = isFundamentalsCacheFresh(cached, ctx.cutoff)
  const targetFresh = !needsTargetRefresh(cached)
  if (priceFresh && targetFresh) return false
  if (!ctx.marketOpen && cached && !priceFresh && targetFresh) return false
  return true
}

async function readFundamentalsRows(
  supabase: Supabase,
  syms: string[],
): Promise<{
  byTicker: Map<string, StockFundamentals & { fetched_at?: string }>
  tableMissing: boolean
}> {
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

  return { byTicker, tableMissing }
}

function toRecord(
  syms: string[],
  byTicker: Map<string, StockFundamentals>,
): Record<string, StockFundamentals> {
  const out: Record<string, StockFundamentals> = {}
  for (const sym of syms) {
    const row = byTicker.get(sym)
    if (row) out[sym] = row
  }
  return out
}

async function refreshOneTicker(
  supabase: Supabase,
  sym: string,
  cached: (StockFundamentals & { fetched_at?: string }) | undefined,
  ctx: RefreshContext,
): Promise<StockFundamentals | null> {
  const priceFresh = cached && isFundamentalsCacheFresh(cached, ctx.cutoff)
  const targetFresh = cached && !needsTargetRefresh(cached)

  if (priceFresh && targetFresh) return cached ?? null

  // Target-only refresh — runs any time (including after 5pm IST when US market is closed)
  if (priceFresh && !targetFresh) {
    const targetFields = await fetchAndResolveTarget(sym, cached!.week52_high ?? null)
    const next: StockFundamentals = { ...cached!, ...targetFields }
    if (ctx.shouldUpsert) {
      await upsertFundamentals(supabase, next, cached!.fetched_at ?? ctx.nowIso)
    }
    return next
  }

  // Outside regular session: keep stale price data but still allow target refresh above
  if (!ctx.marketOpen && cached && !priceFresh) {
    if (!targetFresh) {
      const targetFields = await fetchAndResolveTarget(sym, cached.week52_high ?? null)
      const next: StockFundamentals = { ...cached, ...targetFields }
      if (ctx.shouldUpsert) {
        await upsertFundamentals(supabase, next, cached.fetched_at ?? ctx.nowIso)
      }
      return next
    }
    return cached
  }

  let next: StockFundamentals

  if (!cached) {
    next = await fetchStockFundamentals(sym)
  } else if (!priceFresh) {
    const priceData = await fetchStockPriceData(sym)
    next = {
      ...cached,
      ...priceData,
      fetched_at: ctx.nowIso,
    } as StockFundamentals & { fetched_at?: string }

    if (!targetFresh) {
      const targetFields = await fetchAndResolveTarget(sym, next.week52_high ?? null)
      next = { ...next, ...targetFields }
    }
  } else {
    return cached
  }

  if (ctx.shouldUpsert) {
    await upsertFundamentals(
      supabase,
      next as StockFundamentals & { fetched_at?: string },
      (next as { fetched_at?: string }).fetched_at ?? ctx.nowIso,
    )
  }

  return next
}

/** Read cached rows from DB; list tickers that still need a live refresh. */
export async function loadFundamentalsCacheFirst(
  supabase: Supabase,
  tickers: string[],
): Promise<{
  fundamentals: Record<string, StockFundamentals>
  stale: string[]
  tableMissing: boolean
}> {
  const syms = [...new Set(tickers.map((t) => t.toUpperCase()))]
  if (!syms.length) return { fundamentals: {}, stale: [], tableMissing: false }

  const cutoff = fundamentalsCacheCutoff()
  const marketOpen = isUSMarketOpen()
  const { byTicker, tableMissing } = await readFundamentalsRows(supabase, syms)

  const stale = syms.filter((sym) =>
    needsAnyRefresh(byTicker.get(sym), { cutoff, marketOpen }),
  )

  return {
    fundamentals: toRecord(syms, byTicker),
    stale,
    tableMissing,
  }
}

/** Refresh stale tickers in parallel (used by batch background jobs and blocking loaders). */
export async function refreshFundamentalsForTickers(
  supabase: Supabase,
  tickers: string[],
  options?: { upsert?: boolean; concurrency?: number },
): Promise<Record<string, StockFundamentals>> {
  const syms = [...new Set(tickers.map((t) => t.toUpperCase()))]
  if (!syms.length) return {}

  const cutoff = fundamentalsCacheCutoff()
  const { byTicker, tableMissing } = await readFundamentalsRows(supabase, syms)
  const shouldUpsert = options?.upsert !== false && !tableMissing
  const marketOpen = isUSMarketOpen()
  const nowIso = new Date().toISOString()
  const ctx: RefreshContext = { shouldUpsert, marketOpen, cutoff, nowIso }
  const concurrency = options?.concurrency ?? FUNDAMENTALS_REFRESH_CONCURRENCY

  const toRefresh = syms.filter((sym) => needsAnyRefresh(byTicker.get(sym), ctx))
  if (!toRefresh.length) return toRecord(syms, byTicker)

  await mapPool(toRefresh, concurrency, async (sym) => {
    const next = await refreshOneTicker(supabase, sym, byTicker.get(sym), ctx)
    if (next) byTicker.set(sym, next)
  })

  return toRecord(syms, byTicker)
}

export async function loadFundamentalsForTickers(
  supabase: Supabase,
  tickers: string[],
  options?: { upsert?: boolean; concurrency?: number },
): Promise<Record<string, StockFundamentals>> {
  return refreshFundamentalsForTickers(supabase, tickers, options)
}
