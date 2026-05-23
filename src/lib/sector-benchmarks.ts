/**
 * Sector ETF benchmarks — shared cache (11 rows, 30 min TTL).
 * RS comparisons use regularMarketChangePercent for 1d (not extended hours).
 */

import { fundamentalsCacheCutoff } from '@/lib/fundamentals-cache'
import { fetchYahooHistory, mapPool } from '@/lib/fundamentals-fetch'
import { fetchRegularSnapshotsForTickers } from '@/lib/live-prices'
import { isUSMarketOpen } from '@/lib/market-hours'
import type { BenchmarkableSector } from '@/lib/sector-relative-strength-scoring'
import { BENCHMARKABLE_SECTORS } from '@/lib/sector-relative-strength-scoring'
import type { createServerClient } from '@/lib/supabase'
import type { SectorBenchmark } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

/** Sector → liquid US sector ETF proxy (Yahoo chart). */
export const SECTOR_ETF_MAP: Record<BenchmarkableSector, string> = {
  Technology: 'XLK',
  Healthcare: 'XLV',
  Financials: 'XLF',
  'Consumer Discretionary': 'XLY',
  'Consumer Staples': 'XLP',
  Energy: 'XLE',
  Industrials: 'XLI',
  Materials: 'XLB',
  Utilities: 'XLU',
  'Real Estate': 'XLRE',
  'Communication Services': 'XLC',
}

const REFRESH_LOCK_SECONDS = 60

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function rowToBenchmark(row: Record<string, unknown>): SectorBenchmark {
  return {
    sector: row.sector as BenchmarkableSector,
    benchmark_ticker: String(row.benchmark_ticker),
    change_1d_pct: num(row.change_1d_pct),
    change_7d_pct: num(row.change_7d_pct),
    change_14d_pct: num(row.change_14d_pct),
    change_30d_pct: num(row.change_30d_pct),
    fetched_at: String(row.fetched_at),
  }
}

/** fetchYahooHistory uses range=1y — enough for 7/14/30d windows on sector ETFs. */
async function fetchOneSectorBenchmark(sector: BenchmarkableSector): Promise<SectorBenchmark> {
  const benchmark_ticker = SECTOR_ETF_MAP[sector]
  const [history, quotes] = await Promise.all([
    fetchYahooHistory(benchmark_ticker),
    fetchRegularSnapshotsForTickers([benchmark_ticker]),
  ])
  const snap = quotes.get(benchmark_ticker)

  return {
    sector,
    benchmark_ticker,
    change_1d_pct: snap?.change_1d_pct ?? null,
    change_7d_pct: history?.change_7d_pct ?? null,
    change_14d_pct: history?.change_14d_pct ?? null,
    change_30d_pct: history?.change_30d_pct ?? null,
    fetched_at: new Date().toISOString(),
  }
}

async function readBenchmarkRows(
  supabase: Supabase,
): Promise<{ bySector: Map<BenchmarkableSector, SectorBenchmark>; tableMissing: boolean }> {
  const { data: rows, error } = await supabase.from('sector_benchmarks').select('*')

  const tableMissing = Boolean(
    error?.message?.includes('sector_benchmarks') || error?.message?.includes('PGRST205'),
  )

  const bySector = new Map<BenchmarkableSector, SectorBenchmark>()
  for (const row of rows ?? []) {
    const sector = String(row.sector) as BenchmarkableSector
    if (!(BENCHMARKABLE_SECTORS as readonly string[]).includes(sector)) continue
    bySector.set(sector, rowToBenchmark(row as Record<string, unknown>))
  }

  return { bySector, tableMissing }
}

function isBenchmarkFresh(fetchedAt: string | undefined, cutoff: string): boolean {
  return Boolean(fetchedAt && fetchedAt >= cutoff)
}

function needsBenchmarkRefresh(
  row: SectorBenchmark | undefined,
  cutoff: string,
  marketOpen: boolean,
): boolean {
  if (!row) return true
  if (isBenchmarkFresh(row.fetched_at, cutoff)) return false
  if (!marketOpen && row) return false
  return true
}

async function tryAcquireRefreshLock(supabase: Supabase): Promise<boolean> {
  const now = new Date().toISOString()
  const lockUntil = new Date(Date.now() + REFRESH_LOCK_SECONDS * 1000).toISOString()

  const { data: lock, error } = await supabase
    .from('sector_benchmarks_lock')
    .select('refreshing, locked_until')
    .eq('id', 1)
    .maybeSingle()

  if (error?.message?.includes('sector_benchmarks_lock')) return true

  if (lock?.refreshing && lock.locked_until && lock.locked_until > now) {
    return false
  }

  const { error: upsertError } = await supabase.from('sector_benchmarks_lock').upsert({
    id: 1,
    refreshing: true,
    locked_until: lockUntil,
  })

  return !upsertError
}

async function releaseRefreshLock(supabase: Supabase): Promise<void> {
  await supabase.from('sector_benchmarks_lock').upsert({
    id: 1,
    refreshing: false,
    locked_until: new Date().toISOString(),
  })
}

export async function refreshSectorBenchmarks(
  supabase: Supabase,
  options?: { upsert?: boolean },
): Promise<Record<BenchmarkableSector, SectorBenchmark>> {
  const shouldUpsert = options?.upsert !== false

  const rows = await mapPool([...BENCHMARKABLE_SECTORS], 4, fetchOneSectorBenchmark)
  const out: Partial<Record<BenchmarkableSector, SectorBenchmark>> = {}
  for (const row of rows) {
    out[row.sector as BenchmarkableSector] = row
    if (shouldUpsert) {
      const { error } = await supabase.from('sector_benchmarks').upsert(row, { onConflict: 'sector' })
      if (error) {
        console.warn(`[sector-benchmarks] upsert failed ${row.sector}:`, error.message)
      }
    }
  }

  console.info(`[sector-benchmarks] refreshed ${Object.keys(out).length}/${BENCHMARKABLE_SECTORS.length} sector ETFs`)
  return out as Record<BenchmarkableSector, SectorBenchmark>
}

/** Read cached sector benchmarks; list whether a background refresh is needed. */
export async function loadSectorBenchmarksCacheFirst(
  supabase: Supabase,
): Promise<{
  benchmarks: Partial<Record<BenchmarkableSector, SectorBenchmark>>
  stale: boolean
  tableMissing: boolean
  fetched_at: string | null
}> {
  const cutoff = fundamentalsCacheCutoff()
  const marketOpen = isUSMarketOpen()
  const { bySector, tableMissing } = await readBenchmarkRows(supabase)

  const stale = BENCHMARKABLE_SECTORS.some((sector) =>
    needsBenchmarkRefresh(bySector.get(sector), cutoff, marketOpen),
  )

  let fetched_at: string | null = null
  for (const row of bySector.values()) {
    if (!fetched_at || row.fetched_at < fetched_at) fetched_at = row.fetched_at
  }

  const benchmarks: Partial<Record<BenchmarkableSector, SectorBenchmark>> = {}
  for (const sector of BENCHMARKABLE_SECTORS) {
    const row = bySector.get(sector)
    if (row) benchmarks[sector] = row
  }

  return { benchmarks, stale, tableMissing, fetched_at }
}

/** Stale-while-revalidate with a DB refresh lock (max one 11-ETF burst per lock window). */
export async function loadSectorBenchmarksWithRefresh(
  supabase: Supabase,
): Promise<{
  benchmarks: Partial<Record<BenchmarkableSector, SectorBenchmark>>
  refreshing: boolean
  fetched_at: string | null
}> {
  const cached = await loadSectorBenchmarksCacheFirst(supabase)

  if (!cached.stale || cached.tableMissing) {
    return {
      benchmarks: cached.benchmarks,
      refreshing: false,
      fetched_at: cached.fetched_at,
    }
  }

  const acquired = await tryAcquireRefreshLock(supabase)
  if (!acquired) {
    return {
      benchmarks: cached.benchmarks,
      refreshing: true,
      fetched_at: cached.fetched_at,
    }
  }

  try {
    const fresh = await refreshSectorBenchmarks(supabase, { upsert: !cached.tableMissing })
    let fetched_at = cached.fetched_at
    for (const row of Object.values(fresh)) {
      if (!fetched_at || row.fetched_at > fetched_at) fetched_at = row.fetched_at
    }
    return { benchmarks: fresh, refreshing: false, fetched_at }
  } finally {
    await releaseRefreshLock(supabase)
  }
}

export async function scheduleSectorBenchmarksRefreshIfStale(supabase: Supabase): Promise<void> {
  const cached = await loadSectorBenchmarksCacheFirst(supabase)
  if (!cached.stale || cached.tableMissing) return

  const acquired = await tryAcquireRefreshLock(supabase)
  if (!acquired) return

  try {
    await refreshSectorBenchmarks(supabase, { upsert: true })
  } finally {
    await releaseRefreshLock(supabase)
  }
}

/** Returns benchmarks for API routes — sync refresh when cache is empty or stale. */
export async function ensureSectorBenchmarksLoaded(supabase: Supabase): Promise<{
  benchmarks: Partial<Record<BenchmarkableSector, SectorBenchmark>>
  refreshing: boolean
  fetched_at: string | null
  tableMissing: boolean
}> {
  const cached = await loadSectorBenchmarksCacheFirst(supabase)
  const filled = Object.keys(cached.benchmarks).length

  if (cached.tableMissing) {
    return { ...cached, refreshing: false }
  }

  // Cold start after migration: table exists but has no rows — must block once.
  const needsSyncRefresh = cached.stale && (filled === 0 || filled < BENCHMARKABLE_SECTORS.length)

  if (!needsSyncRefresh) {
    if (cached.stale) {
      void scheduleSectorBenchmarksRefreshIfStale(supabase).catch((err) => {
        console.warn('[sector-benchmarks] background refresh failed:', err)
      })
    }
    return {
      benchmarks: cached.benchmarks,
      refreshing: cached.stale,
      fetched_at: cached.fetched_at,
      tableMissing: false,
    }
  }

  const result = await loadSectorBenchmarksWithRefresh(supabase)
  return {
    benchmarks: result.benchmarks,
    refreshing: result.refreshing,
    fetched_at: result.fetched_at,
    tableMissing: false,
  }
}

export function sectorBenchmarkAgeMinutes(fetchedAt: string | null): number | null {
  if (!fetchedAt) return null
  return Math.floor((Date.now() - new Date(fetchedAt).getTime()) / 60_000)
}
