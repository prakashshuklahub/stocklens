import { auth, getSessionUserId } from '@/lib/auth'
import {
  loadFundamentalsCacheFirst,
  refreshFundamentalsForTickers,
} from '@/lib/load-fundamentals'
import { fetchRegularSnapshotsForTickers } from '@/lib/live-prices'
import type { StockSnapshot } from '@/types'
import {
  ensureSectorBenchmarksLoaded,
  sectorBenchmarkAgeMinutes,
} from '@/lib/sector-benchmarks'
import { computeVsSectorMap } from '@/lib/sector-relative-strength'
import type { BenchmarkableSector } from '@/lib/sector-relative-strength-scoring'
import { createServerClient } from '@/lib/supabase'
import { after, NextRequest, NextResponse } from 'next/server'
import type { FundamentalsBatchResponse, SectorBenchmark, StockFundamentals } from '@/types'

const MAX_TICKERS = 40

function overlayLiveSectorDayPct(
  sector_benchmarks: Record<string, SectorBenchmark>,
  quotes: Map<string, StockSnapshot>,
): Record<string, SectorBenchmark> {
  const out: Record<string, SectorBenchmark> = { ...sector_benchmarks }
  for (const [sector, row] of Object.entries(out)) {
    const live = quotes.get(row.benchmark_ticker.toUpperCase())
    if (live?.change_1d_pct == null) continue
    out[sector] = { ...row, change_1d_pct: live.change_1d_pct }
  }
  return out
}

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('tickers') ?? ''
  const tickers = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_TICKERS)

  const empty: FundamentalsBatchResponse = {
    fundamentals: {},
    vs_sector: {},
    sector_benchmarks: {},
    regular_change_1d_pct: {},
    sector_benchmarks_refreshing: false,
    sector_benchmarks_age_minutes: null,
    refreshing: false,
  }

  if (!tickers.length) {
    return NextResponse.json(empty)
  }

  const supabase = createServerClient()

  const [{ fundamentals, stale }, sectorLoaded, watchlistSectors] = await Promise.all([
    loadFundamentalsCacheFirst(supabase, tickers),
    ensureSectorBenchmarksLoaded(supabase),
    supabase.from('watchlist_stocks').select('ticker, sector').eq('user_id', userId).in('ticker', tickers),
  ])

  let sector_benchmarks: Record<string, SectorBenchmark> = {}
  for (const [sector, row] of Object.entries(sectorLoaded.benchmarks)) {
    if (row) sector_benchmarks[sector] = row
  }

  const etfTickers = [
    ...new Set(Object.values(sector_benchmarks).map((b) => b.benchmark_ticker.toUpperCase())),
  ]
  const regularQuotes = await fetchRegularSnapshotsForTickers([...tickers, ...etfTickers])

  sector_benchmarks = overlayLiveSectorDayPct(sector_benchmarks, regularQuotes)

  const sectorsByTicker: Record<string, string | null> = {}
  for (const row of watchlistSectors.data ?? []) {
    sectorsByTicker[String(row.ticker).toUpperCase()] = row.sector as string | null
  }

  const vs_sector = computeVsSectorMap(
    tickers,
    sectorsByTicker,
    fundamentals as Record<string, StockFundamentals>,
    sector_benchmarks as Partial<Record<BenchmarkableSector, SectorBenchmark>>,
  )

  const regular_change_1d_pct: Record<string, number> = {}
  for (const sym of tickers) {
    const snap = regularQuotes.get(sym)
    if (snap?.change_1d_pct != null) regular_change_1d_pct[sym] = snap.change_1d_pct
  }

  let fundamentalsRefreshing = false
  if (stale.length) {
    fundamentalsRefreshing = true
    console.info(
      `[fundamentals/batch] cache hit ${tickers.length - stale.length}/${tickers.length}, refreshing ${stale.length} in background`,
    )
    after(async () => {
      await refreshFundamentalsForTickers(supabase, stale)
    })
  }

  const sector_benchmarks_refreshing = sectorLoaded.refreshing

  const response: FundamentalsBatchResponse = {
    fundamentals,
    vs_sector,
    sector_benchmarks,
    regular_change_1d_pct,
    sector_benchmarks_refreshing,
    sector_benchmarks_age_minutes: sectorBenchmarkAgeMinutes(sectorLoaded.fetched_at),
    refreshing: fundamentalsRefreshing || sector_benchmarks_refreshing,
  }

  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'private, max-age=60' },
  })
}
