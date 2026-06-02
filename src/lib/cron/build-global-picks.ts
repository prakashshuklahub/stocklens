import { usTradingDateString } from '@/lib/global-picks-schedule'
import {
  computeSectorPeMedians,
  PICKS_V2_MAX_RESULTS,
  PICKS_V2_MIN_PUBLISH_COUNT,
  PICKS_V2_MIN_SCORE,
  PICKS_V2_MIN_ANALYSTS,
  rankGlobalPicks,
  scorePickV2,
  sectorPeMedianForTicker,
} from '@/lib/picks-scoring-v2'
import { normalizeWatchlistSector, isBenchmarkableSector, type BenchmarkableSector } from '@/lib/sector-relative-strength-scoring'
import { ensureSectorBenchmarksLoaded } from '@/lib/sector-benchmarks'
import type { PickScoreInput, PickCandidate } from '@/lib/picks-scoring'
import { loadResearchBatchFromDb } from '@/lib/stock-research-cache'
import type { createServerClient } from '@/lib/supabase'
import type { ScoredPick } from '@/lib/picks-scoring'
import type { StockFundamentals } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

export type BuildGlobalPicksResult = {
  run_id: string
  run_date: string
  status: 'completed' | 'failed'
  published: boolean
  universe_count: number
  qualified_count: number
  tickers: string[]
}

function priceFromFundamentals(f: StockFundamentals): number | null {
  if (f.last_price != null && f.last_price >= 5) return f.last_price
  if (f.avg_20d != null && f.avg_20d >= 5) return f.avg_20d
  return null
}

function sectorForBenchmark(sector: string | null | undefined) {
  const normalized = normalizeWatchlistSector(sector)
  return isBenchmarkableSector(normalized) ? normalized : null
}

export async function buildGlobalPicksInDb(supabase: Supabase): Promise<BuildGlobalPicksResult> {
  const run_date = usTradingDateString()
  const config = {
    minScore: PICKS_V2_MIN_SCORE,
    minAnalysts: PICKS_V2_MIN_ANALYSTS,
    maxResults: PICKS_V2_MAX_RESULTS,
    minPublishCount: PICKS_V2_MIN_PUBLISH_COUNT,
    version: 2,
  }

  const { data: runRow, error: runInsertError } = await supabase
    .from('global_top_picks_runs')
    .insert({
      run_date,
      status: 'running',
      published: false,
      config,
      min_score_used: PICKS_V2_MIN_SCORE,
    })
    .select('id')
    .single()

  if (runInsertError || !runRow?.id) {
    throw new Error(runInsertError?.message ?? 'Failed to create global picks run')
  }

  const run_id = runRow.id as string

  try {
    const { data: fundRows, error: fundError } = await supabase
      .from('stock_fundamentals')
      .select('*')

    if (fundError) throw new Error(fundError.message)

    const fundamentals = (fundRows ?? []) as StockFundamentals[]
    const tickers = fundamentals.map((f) => f.ticker.toUpperCase())

    const researchByTicker = await loadResearchBatchFromDb(supabase, tickers)
    const sectorLoaded = await ensureSectorBenchmarksLoaded(supabase)
    const sectorBenchmarks = sectorLoaded.benchmarks

    const sectorByTicker = new Map<string, string | null>()
    for (const f of fundamentals) {
      sectorByTicker.set(f.ticker.toUpperCase(), null)
    }
    const sectorPeMedians = computeSectorPeMedians(researchByTicker, sectorByTicker)

    const scored: ScoredPick[] = []

    for (const f of fundamentals) {
      const sym = f.ticker.toUpperCase()
      const current_price = priceFromFundamentals(f)
      if (current_price == null) continue

      const research = researchByTicker.get(sym) ?? null
      const sector = research ? null : null

      const candidate: PickCandidate = {
        ticker: sym,
        company_name: sym,
        sector,
        source: 'discovery',
      }

      const benchmarkSector = sectorForBenchmark(sector)
      const benchmark = benchmarkSector
        ? sectorBenchmarks[benchmarkSector as BenchmarkableSector] ?? null
        : null

      const input: PickScoreInput = {
        candidate,
        current_price,
        change_1d_pct: f.change_1d_pct ?? null,
        fundamentals: f,
        ownership: null,
        benchmark,
        researchContext: {
          research,
          sectorPeMedian: sectorPeMedianForTicker(sector, sectorPeMedians),
        },
      }

      const pick = scorePickV2(input)
      if (pick) scored.push(pick)
    }

    const ranked = rankGlobalPicks(scored, PICKS_V2_MAX_RESULTS)
    const shouldPublish = ranked.length >= PICKS_V2_MIN_PUBLISH_COUNT

    if (ranked.length) {
      const pickRows = ranked.map((p, i) => ({
        run_id,
        rank: i + 1,
        ticker: p.ticker.toUpperCase(),
        score: p.score,
        confidence: p.confidence,
        snapshot: {
          ...p,
          target_label: 'analyst' as const,
        },
      }))

      const { error: picksError } = await supabase.from('global_top_picks').insert(pickRows)
      if (picksError) throw new Error(picksError.message)
    }

    await supabase
      .from('global_top_picks_runs')
      .update({
        status: 'failed',
        published: false,
        error_message: 'Superseded by newer run',
      })
      .eq('run_date', run_date)
      .eq('status', 'completed')
      .neq('id', run_id)

    const { error: updateError } = await supabase
      .from('global_top_picks_runs')
      .update({
        status: 'completed',
        published: shouldPublish,
        completed_at: new Date().toISOString(),
        universe_count: fundamentals.length,
        qualified_count: ranked.length,
      })
      .eq('id', run_id)

    if (updateError) throw new Error(updateError.message)

    return {
      run_id,
      run_date,
      status: 'completed',
      published: shouldPublish,
      universe_count: fundamentals.length,
      qualified_count: ranked.length,
      tickers: ranked.map((p) => p.ticker),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await supabase
      .from('global_top_picks_runs')
      .update({
        status: 'failed',
        published: false,
        error_message: message,
        completed_at: new Date().toISOString(),
      })
      .eq('id', run_id)

    return {
      run_id,
      run_date,
      status: 'failed',
      published: false,
      universe_count: 0,
      qualified_count: 0,
      tickers: [],
    }
  }
}
