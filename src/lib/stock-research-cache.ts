import { fetchStockResearchFromApis } from '@/lib/research-fetch'
import type { createServerClient } from '@/lib/supabase'
import type { StockResearchSnapshot } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

const onDemandInflight = new Map<string, Promise<StockResearchSnapshot | null>>()

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

export type ResearchTickerUniverse = {
  watchlist: Set<string>
  all: string[]
}

export async function loadResearchBatchFromDb(
  supabase: Supabase,
  tickers: string[],
): Promise<Map<string, StockResearchSnapshot>> {
  const unique = [...new Set(tickers.map((t) => t.toUpperCase()))]
  const out = new Map<string, StockResearchSnapshot>()
  if (!unique.length) return out

  const CHUNK = 100
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK)
    const { data, error } = await supabase.from('stock_research_cache').select('*').in('ticker', chunk)
    if (error) {
      console.warn('[stock-research-cache] batch SELECT failed:', error.message)
      continue
    }
    for (const row of data ?? []) {
      out.set(String(row.ticker).toUpperCase(), rowToResearchSnapshot(row as StockResearchCacheRow))
    }
  }
  return out
}

/** All users' watchlists + portfolio + fundamentals + trending discovery pool. */
export async function listResearchTickerUniverse(
  supabase: Supabase,
  options?: { discoveryTickers?: string[] },
): Promise<ResearchTickerUniverse> {
  const watchlist = new Set<string>()
  const all = new Set<string>()

  const [wlRes, pfRes, fdRes] = await Promise.all([
    supabase.from('watchlist_stocks').select('ticker'),
    supabase.from('portfolio_holdings').select('ticker'),
    supabase.from('stock_fundamentals').select('ticker'),
  ])

  for (const row of wlRes.data ?? []) {
    if (row.ticker) watchlist.add(String(row.ticker).toUpperCase())
  }
  for (const row of [...(wlRes.data ?? []), ...(pfRes.data ?? []), ...(fdRes.data ?? [])]) {
    if (row.ticker) all.add(String(row.ticker).toUpperCase())
  }
  for (const t of options?.discoveryTickers ?? []) {
    all.add(t.toUpperCase())
  }

  return { watchlist, all: [...all].sort() }
}

/** Cron queue: missing → watchlist missing → discovery missing → oldest refresh. */
export function sortResearchRefreshQueue(
  tickers: string[],
  watchlist: Set<string>,
  fetchedAtByTicker: Map<string, string>,
  discoveryPriority?: Set<string>,
): string[] {
  return tickers
    .filter((t) => needsResearchRefresh(fetchedAtByTicker.get(t)))
    .sort((a, b) => {
      const aMissing = !fetchedAtByTicker.has(a)
      const bMissing = !fetchedAtByTicker.has(b)
      if (aMissing !== bMissing) return aMissing ? -1 : 1

      const aWatch = watchlist.has(a)
      const bWatch = watchlist.has(b)
      if (aWatch !== bWatch) return aWatch ? -1 : 1

      const aDiscovery = discoveryPriority?.has(a) ?? false
      const bDiscovery = discoveryPriority?.has(b) ?? false
      if (aDiscovery !== bDiscovery) return aDiscovery ? -1 : 1

      const aAt = fetchedAtByTicker.get(a)
      const bAt = fetchedAtByTicker.get(b)
      if (!aAt && !bAt) return a.localeCompare(b)
      if (!aAt) return -1
      if (!bAt) return 1
      return new Date(aAt).getTime() - new Date(bAt).getTime()
    })
}

async function fetchAndStoreResearch(sym: string, supabase: Supabase): Promise<StockResearchSnapshot | null> {
  const pending = onDemandInflight.get(sym)
  if (pending) return pending

  const work = (async () => {
    try {
      const snapshot = await fetchStockResearchFromApis(sym)
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

/** Fetch one ticker from Finnhub/FMP → DB. Skips if row exists when onlyIfMissing. */
export async function ensureResearchForTicker(
  supabase: Supabase,
  ticker: string,
  options?: { onlyIfMissing?: boolean },
): Promise<StockResearchSnapshot | null> {
  const sym = ticker.toUpperCase()
  if (options?.onlyIfMissing) {
    const cached = await loadResearchFromDb(supabase, sym)
    if (cached) return cached.data
  }
  return fetchAndStoreResearch(sym, supabase)
}

/** Read DB; on miss fetch Finnhub/FMP once → upsert → return. */
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

  return { ok: false, reason: 'pending' }
}
