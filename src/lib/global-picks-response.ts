import { isLLMEnabled } from '@/lib/llm'
import { nextGlobalPicksRefreshAt, usTradingDateString } from '@/lib/global-picks-schedule'
import type { ScoredPick } from '@/lib/picks-scoring'
import {
  attachPickNarratives,
  loadCachedPickNarratives,
  schedulePickNarrativeGeneration,
} from '@/lib/pick-narratives'
import { latestIso } from '@/lib/picks-pipeline'
import { fetchLivePricesForTickers } from '@/lib/live-prices'
import { computeTargetUpsidePct } from '@/lib/target-price-display'
import { ensureSectorBenchmarksLoaded } from '@/lib/sector-benchmarks'
import { isBenchmarkableSector, type BenchmarkableSector } from '@/lib/sector-relative-strength-scoring'
import type { createServerClient } from '@/lib/supabase'
import type { Pick, PicksResponse, PortfolioHolding, SignalNewsItem, StockFundamentals } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

const EMPTY_NEWS = new Map<string, SignalNewsItem[]>()

/** Drop picks when live price is more than this % above avg analyst target (see applyLivePriceToPick). */
export const PICKS_LIVE_MIN_UPSIDE_PCT = -5
/** Drop picks when live upside is below this % (near/at target). */
export const PICKS_LIVE_TARGET_NEAR_MAX_PCT = 3

export function pickPassesLiveUpsideGate(p: Pick): boolean {
  if (!p.target_mean || p.target_mean <= 0) return true
  if (p.upside_pct == null || !Number.isFinite(p.upside_pct)) return true
  if (p.upside_pct < PICKS_LIVE_TARGET_NEAR_MAX_PCT) return false
  return p.upside_pct >= PICKS_LIVE_MIN_UPSIDE_PCT
}

type GlobalRunRow = {
  id: string
  run_date: string
  published: boolean
  completed_at: string | null
  qualified_count: number | null
}

type GlobalPickRow = {
  rank: number
  ticker: string
  snapshot: Pick
}

async function loadLatestPublishedRun(supabase: Supabase): Promise<GlobalRunRow | null> {
  const { data, error } = await supabase
    .from('global_top_picks_runs')
    .select('id, run_date, published, completed_at, qualified_count')
    .eq('published', true)
    .order('run_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.warn('[global-picks] load published run:', error.message)
    return null
  }
  return (data as GlobalRunRow | null) ?? null
}

async function loadRunForDate(supabase: Supabase, run_date: string): Promise<GlobalRunRow | null> {
  const { data, error } = await supabase
    .from('global_top_picks_runs')
    .select('id, run_date, published, completed_at, qualified_count')
    .eq('run_date', run_date)
    .eq('published', true)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return null
  return (data as GlobalRunRow | null) ?? null
}

async function loadPicksForRun(supabase: Supabase, run_id: string): Promise<GlobalPickRow[]> {
  const { data, error } = await supabase
    .from('global_top_picks')
    .select('rank, ticker, snapshot')
    .eq('run_id', run_id)
    .order('rank', { ascending: true })

  if (error) {
    console.warn('[global-picks] load picks:', error.message)
    return []
  }
  return (data ?? []) as GlobalPickRow[]
}

/** Recompute upside and buy zone when live price differs from the cron snapshot. */
function applyLivePriceToPick(p: Pick, newPrice: number): Pick {
  const oldPrice = p.current_price
  if (oldPrice <= 0 || newPrice <= 0) return p

  const upside_pct = computeTargetUpsidePct(p.target_mean, newPrice) ?? p.upside_pct

  if (Math.abs(newPrice - oldPrice) < 0.001) {
    return { ...p, current_price: newPrice, upside_pct }
  }

  const scaledEntryLow =
    p.entry_high > 0 ? (p.entry_low / p.entry_high) * newPrice : newPrice * 0.97
  const entry_low = Math.min(Math.max(scaledEntryLow, newPrice * 0.97), newPrice)
  const entry_high = newPrice

  return {
    ...p,
    current_price: newPrice,
    upside_pct,
    entry_low,
    entry_high,
  }
}

function sectorBenchmarksRecord(
  benchmarks: Partial<Record<BenchmarkableSector, import('@/types').SectorBenchmark | null>>,
): Record<string, import('@/types').SectorBenchmark> {
  return Object.fromEntries(
    Object.entries(benchmarks).filter(
      (entry): entry is [string, import('@/types').SectorBenchmark] => entry[1] != null,
    ),
  )
}

export async function buildGlobalPicksApiResponse(
  supabase: Supabase,
  userId: string,
  options: { overlayLivePrices: boolean } = { overlayLivePrices: true },
): Promise<PicksResponse> {
  const today = usTradingDateString()
  const todayRun = await loadRunForDate(supabase, today)
  const fallbackRun = await loadLatestPublishedRun(supabase)

  const activeRun = todayRun ?? fallbackRun
  const stale = Boolean(activeRun && !todayRun)

  const scoresAt = activeRun?.completed_at ?? new Date().toISOString()
  const generated_at = activeRun?.completed_at ?? null
  const qualified_count = activeRun?.qualified_count ?? 0

  if (!activeRun) {
    return {
      picks: [],
      scores_at: scoresAt,
      generated_at: null,
      next_refresh_at: nextGlobalPicksRefreshAt(),
      qualified_count: 0,
      stale: false,
      narratives_at: null,
      llm_enabled: isLLMEnabled(),
      sector_benchmarks: {},
    }
  }

  const rows = await loadPicksForRun(supabase, activeRun.id)
  let picks: Pick[] = rows.map((r) => ({
    ...r.snapshot,
    ticker: r.ticker.toUpperCase(),
  }))

  const tickers = picks.map((p) => p.ticker)

  const [portfolioResult, sectorLoaded] = await Promise.all([
    supabase.from('portfolio_holdings').select('*').eq('user_id', userId),
    ensureSectorBenchmarksLoaded(supabase),
  ])

  const portfolio = (portfolioResult.data ?? []) as PortfolioHolding[]

  if (options.overlayLivePrices && tickers.length) {
    const live = await fetchLivePricesForTickers(tickers)
    picks = picks.map((p) => {
      const snap = live.get(p.ticker)
      if (!snap?.price) return p
      return applyLivePriceToPick(
        {
          ...p,
          change_1d_pct: snap.change_1d_pct ?? p.change_1d_pct,
          change_1d_session: snap.session ?? p.change_1d_session,
        },
        snap.price,
      )
    })
  }

  const beforeLiveFilter = picks.length
  picks = picks.filter(pickPassesLiveUpsideGate)
  if (beforeLiveFilter > picks.length) {
    console.info(
      `[global-picks] filtered ${beforeLiveFilter - picks.length} pick(s) below ${PICKS_LIVE_MIN_UPSIDE_PCT}% live upside`,
    )
  }

  picks = picks.map((p) => {
    const sym = p.ticker.toUpperCase()
    const holding = portfolio.find((h) => h.ticker.toUpperCase() === sym)
    const ownership =
      holding && p.current_price > 0
        ? {
            shares: holding.quantity,
            avg_cost_basis: holding.avg_cost_basis,
            current_value: p.current_price * holding.quantity,
          }
        : null

    return {
      ...p,
      ownership,
      source: 'discovery' as const,
    }
  })

  const fundamentalsByTicker = new Map<string, StockFundamentals>()
  for (const p of picks) {
    fundamentalsByTicker.set(p.ticker, {
      ticker: p.ticker,
      change_7d_pct: p.change_7d_pct,
      change_14d_pct: p.change_14d_pct,
      change_30d_pct: p.change_30d_pct,
      week52_high: p.week52_high,
      week52_low: p.week52_low,
      target_mean: p.target_mean,
      target_high: p.target_high,
      target_low: p.target_low,
      target_price: p.target_mean,
      target_source: 'finnhub',
      target_fetched_at: null,
      analyst_buy: p.analyst_buy,
      analyst_hold: p.analyst_hold,
      analyst_sell: p.analyst_sell,
      news_sentiment: null,
      news_count_7d: p.news_count_7d,
      support_5d: null,
      support_20d: null,
      avg_20d: null,
      volume_ratio: p.volume_ratio,
    })
  }

  const scoredShape = picks as unknown as ScoredPick[]
  const filteredTickers = picks.map((p) => p.ticker)
  const cachedNarratives = await loadCachedPickNarratives(supabase, filteredTickers, 'global-picks')
  const { picks: withNarratives, narrativeTimes, pendingLlm } = attachPickNarratives(
    scoredShape,
    cachedNarratives,
    EMPTY_NEWS,
    scoresAt,
  )
  schedulePickNarrativeGeneration(supabase, pendingLlm, fundamentalsByTicker, 'global-picks')

  return {
    picks: withNarratives,
    scores_at: scoresAt,
    generated_at,
    next_refresh_at: nextGlobalPicksRefreshAt(),
    qualified_count,
    stale,
    narratives_at: latestIso(narrativeTimes),
    llm_enabled: isLLMEnabled(),
    sector_benchmarks: sectorBenchmarksRecord(sectorLoaded.benchmarks),
  }
}
