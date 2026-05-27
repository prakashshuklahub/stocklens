import { fetchYahooStockResearchFromYahoo } from '@/lib/yahoo-research'
import { getYahooCrumbRetryAfterMs, YahooRateLimitedError } from '@/lib/yahoo-session'
import type { createServerClient } from '@/lib/supabase'
import type { StockResearchSnapshot } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

const onDemandInflight = new Map<string, Promise<StockResearchSnapshot | null>>()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Wait out short Yahoo cooldowns before an on-demand fetch (user opened the panel). */
async function waitForYahooCooldown(maxWaitMs = 15_000): Promise<boolean> {
  let retryAfterMs = getYahooCrumbRetryAfterMs()
  if (retryAfterMs <= 0) return true
  if (retryAfterMs > maxWaitMs) return false
  await sleep(retryAfterMs + 100)
  retryAfterMs = getYahooCrumbRetryAfterMs()
  return retryAfterMs <= 0
}

/** Refresh when older than this (cron runs hourly). */
export const RESEARCH_TTL_MS = 3 * 60 * 60 * 1000

export type StockResearchCacheRow = {
  ticker: string
  earnings_date: string | null
  ex_dividend_date: string | null
  pe_trailing: number | null
  pe_forward: number | null
  market_cap: number | null
  beta: number | null
  dividend_yield_pct: number | null
  revenue_growth_pct: number | null
  earnings_growth_pct: number | null
  gross_margin_pct: number | null
  operating_margin_pct: number | null
  profit_margin_pct: number | null
  debt_to_equity: number | null
  current_ratio: number | null
  fetched_at: string
}

function num(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function needsResearchRefresh(fetchedAt: string | null | undefined): boolean {
  if (!fetchedAt) return true
  return Date.now() - new Date(fetchedAt).getTime() > RESEARCH_TTL_MS
}

export function rowToResearchSnapshot(row: StockResearchCacheRow): StockResearchSnapshot {
  return {
    ticker: row.ticker.toUpperCase(),
    earnings_date: row.earnings_date,
    ex_dividend_date: row.ex_dividend_date,
    pe_trailing: num(row.pe_trailing),
    pe_forward: num(row.pe_forward),
    market_cap: num(row.market_cap),
    beta: num(row.beta),
    dividend_yield_pct: num(row.dividend_yield_pct),
    revenue_growth_pct: num(row.revenue_growth_pct),
    earnings_growth_pct: num(row.earnings_growth_pct),
    gross_margin_pct: num(row.gross_margin_pct),
    operating_margin_pct: num(row.operating_margin_pct),
    profit_margin_pct: num(row.profit_margin_pct),
    debt_to_equity: num(row.debt_to_equity),
    current_ratio: num(row.current_ratio),
  }
}

export function snapshotToDbRow(data: StockResearchSnapshot, fetchedAt: string): StockResearchCacheRow {
  return {
    ticker: data.ticker.toUpperCase(),
    earnings_date: data.earnings_date,
    ex_dividend_date: data.ex_dividend_date,
    pe_trailing: data.pe_trailing,
    pe_forward: data.pe_forward,
    market_cap: data.market_cap,
    beta: data.beta,
    dividend_yield_pct: data.dividend_yield_pct,
    revenue_growth_pct: data.revenue_growth_pct,
    earnings_growth_pct: data.earnings_growth_pct,
    gross_margin_pct: data.gross_margin_pct,
    operating_margin_pct: data.operating_margin_pct,
    profit_margin_pct: data.profit_margin_pct,
    debt_to_equity: data.debt_to_equity,
    current_ratio: data.current_ratio,
    fetched_at: fetchedAt,
  }
}

export async function loadResearchFromDb(
  supabase: Supabase,
  ticker: string,
): Promise<{ data: StockResearchSnapshot; fetched_at: string } | null> {
  const sym = ticker.toUpperCase()
  const { data, error } = await supabase
    .from('stock_research_cache')
    .select('*')
    .eq('ticker', sym)
    .maybeSingle()

  if (error || !data) return null
  return {
    data: rowToResearchSnapshot(data as StockResearchCacheRow),
    fetched_at: String(data.fetched_at),
  }
}

export async function upsertResearchToDb(
  supabase: Supabase,
  snapshot: StockResearchSnapshot,
  fetchedAt = new Date().toISOString(),
): Promise<void> {
  const row = snapshotToDbRow(snapshot, fetchedAt)
  const { error } = await supabase.from('stock_research_cache').upsert(row, { onConflict: 'ticker' })
  if (error) throw new Error(error.message)
}

export type LoadResearchResult =
  | { ok: true; data: StockResearchSnapshot; fetched_at: string; stale?: boolean }
  | { ok: false; reason: 'pending' }
  | { ok: false; reason: 'rate_limited'; retryAfterMs: number }

async function fetchAndStoreResearch(sym: string, supabase: Supabase): Promise<StockResearchSnapshot | null> {
  const pending = onDemandInflight.get(sym)
  if (pending) return pending

  const work = (async () => {
    try {
      const snapshot = await fetchYahooStockResearchFromYahoo(sym)
      if (!snapshot) return null
      await upsertResearchToDb(supabase, snapshot)
      return snapshot
    } finally {
      onDemandInflight.delete(sym)
    }
  })()

  onDemandInflight.set(sym, work)
  return work
}

/** Read DB; on miss, one queued Yahoo fetch → upsert (first expand fills cache). */
export async function loadOrFetchResearch(
  supabase: Supabase,
  ticker: string,
): Promise<LoadResearchResult> {
  const sym = ticker.toUpperCase()
  const cached = await loadResearchFromDb(supabase, sym)
  if (cached) {
    return {
      ok: true,
      data: cached.data,
      fetched_at: cached.fetched_at,
      stale: needsResearchRefresh(cached.fetched_at),
    }
  }

  try {
    await waitForYahooCooldown()

    const snapshot = await fetchAndStoreResearch(sym, supabase)
    if (snapshot) {
      return { ok: true, data: snapshot, fetched_at: new Date().toISOString() }
    }

    const after = await loadResearchFromDb(supabase, sym)
    if (after) {
      return {
        ok: true,
        data: after.data,
        fetched_at: after.fetched_at,
        stale: needsResearchRefresh(after.fetched_at),
      }
    }

    const retryAfterMs = getYahooCrumbRetryAfterMs()
    if (retryAfterMs > 0) {
      return { ok: false, reason: 'rate_limited', retryAfterMs }
    }

    return { ok: false, reason: 'pending' }
  } catch (err) {
    const after = await loadResearchFromDb(supabase, sym)
    if (after) {
      return {
        ok: true,
        data: after.data,
        fetched_at: after.fetched_at,
        stale: needsResearchRefresh(after.fetched_at),
      }
    }

    if (err instanceof YahooRateLimitedError) {
      return { ok: false, reason: 'rate_limited', retryAfterMs: err.retryAfterMs }
    }
    throw err
  }
}
