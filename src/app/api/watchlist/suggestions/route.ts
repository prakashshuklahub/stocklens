// GET /api/watchlist/suggestions — trending cards ("not on your list").
//
// Candidate source: Yahoo market movers only (see trending-candidates.ts).
// Scoring: watchlist-suggestions-scoring.ts (no watchlist awareness).
// Narratives: same pipeline as Picks (@/lib/stock-narratives).

import { auth, getSessionUserId } from '@/lib/auth'
import { fetchStockFundamentals, mapPool } from '@/lib/fundamentals-fetch'
import { fetchLivePricesForTickers } from '@/lib/live-prices'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
import { fetchYahooSector } from '@/lib/sectors'
import { fetchTrendingCandidates } from '@/lib/trending-candidates'
import { ensureSectorBenchmarksLoaded } from '@/lib/sector-benchmarks'
import { isBenchmarkableSector, type BenchmarkableSector } from '@/lib/sector-relative-strength-scoring'
import { isLLMEnabled } from '@/lib/llm'
import { NARRATIVE_TTL_HOURS } from '@/lib/narrative-cache'
import {
  loadCachedPickNarratives,
  rowToNarrativePayload,
  schedulePickNarrativeGeneration,
} from '@/lib/pick-narratives'
import {
  generateNarrativeForPick,
  mechanicalNarrativeSync,
  persistPickNarrative,
  trendingToScoredPick,
} from '@/lib/stock-narratives'
import {
  rankTrendingSuggestions,
  scoreTrendingCandidate,
  trendingHeadline,
  TRENDING_GLOBAL_RANK_LIMIT,
  type ScoredSuggestion,
} from '@/lib/watchlist-suggestions-scoring'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import type {
  PickNarrativePayload,
  StockFundamentals,
  TrendingNarrative,
  WatchlistSuggestion,
  WatchlistSuggestionsResponse,
} from '@/types'
import type { ScoredPick } from '@/lib/picks-scoring'

const TRENDING_CACHE_HOURS = NARRATIVE_TTL_HOURS
/** Bump when narrative pipeline changes — invalidates stale watchlist_suggestions_cache blurbs. */
const TRENDING_NARRATIVE_VERSION = 2
const CANDIDATE_POOL = 40
/** Max cards returned to one user (after excluding their watchlist). */
const USER_TRENDING_LIMIT = 3
const LLM_BLURB_COUNT = 3
const LLM_BLURB_DELAY_MS = 500
const NO_CACHE = { 'Cache-Control': 'private, no-store, max-age=0' } as const

export type CachedReason = TrendingNarrative & {
  narrative_source: 'llm' | 'mechanical'
}

type LegacyCachedReason = {
  reason: string
  narrative_source: 'llm' | 'mechanical'
}

type CachedPayload = {
  ranked: ScoredSuggestion[]
  reasons: Record<string, CachedReason>
  generated_at: string
  narrative_version?: number
}

function fundMapKey(ticker: string): string {
  return ticker.toUpperCase()
}

function normalizeFundamentalsMap(rows: StockFundamentals[]): Map<string, StockFundamentals> {
  const map = new Map<string, StockFundamentals>()
  for (const row of rows) {
    map.set(fundMapKey(row.ticker), row)
  }
  return map
}

function cachedToNarrative(
  cached: CachedReason | LegacyCachedReason | undefined,
): CachedReason | null {
  if (!cached) return null
  if ('thesis' in cached && cached.company_blurb?.trim() && cached.thesis?.trim() && cached.main_risk?.trim()) {
    return cached as CachedReason
  }
  return null
}

function mechanicalCached(
  s: ScoredSuggestion,
  fundamentals: StockFundamentals | undefined,
): CachedReason | null {
  if (!fundamentals) return null
  const pick = trendingToScoredPick(s, fundamentals)
  return { ...mechanicalNarrativeSync(pick), narrative_source: 'mechanical' }
}

async function loadStoredPayload(
  supabase: ReturnType<typeof createServerClient>,
): Promise<CachedPayload | null> {
  const { data, error } = await supabase
    .from('watchlist_suggestions_cache')
    .select('suggestions, generated_at')
    .eq('cache_key', 'global')
    .maybeSingle()

  if (error) {
    console.warn('[watchlist/suggestions] cache SELECT failed:', error.message)
    return null
  }
  if (!data) return null

  const raw = data.suggestions as CachedPayload | ScoredSuggestion[]
  if (!raw) return null

  if (Array.isArray(raw)) {
    if (!raw.length) return null
    return { ranked: raw, reasons: {}, generated_at: data.generated_at }
  }

  if (!Array.isArray(raw.ranked) || !raw.ranked.length) return null
  return {
    ranked: raw.ranked,
    reasons: raw.reasons ?? {},
    generated_at: data.generated_at,
    narrative_version: raw.narrative_version,
  }
}

function isPayloadFresh(payload: CachedPayload): boolean {
  if (payload.narrative_version !== TRENDING_NARRATIVE_VERSION) return false
  const cutoff = Date.now() - TRENDING_CACHE_HOURS * 3600 * 1000
  return new Date(payload.generated_at).getTime() >= cutoff
}

async function enrichWithBlurbs(
  supabase: ReturnType<typeof createServerClient>,
  ranked: ScoredSuggestion[],
  existing: Record<string, CachedReason>,
  fundamentalsByTicker: Map<string, StockFundamentals>,
): Promise<Record<string, CachedReason>> {
  const reasons = { ...existing }
  const llmEnabled = isLLMEnabled()
  const { fetchHeadlinesForTickers } = await import('@/lib/pick-headlines')
  const targets = ranked.slice(0, LLM_BLURB_COUNT)
  const targetTickers = targets.map((s) => s.ticker)
  const pickNarratives = await loadCachedPickNarratives(
    supabase,
    targetTickers,
    'watchlist/suggestions',
  )
  const headlinesMap = await fetchHeadlinesForTickers(
    targetTickers,
    {
      limit: 3,
      companyNameByTicker: Object.fromEntries(
        targets.map((s) => [fundMapKey(s.ticker), s.company_name]),
      ),
    },
  )

  for (let i = 0; i < targets.length; i++) {
    const s = targets[i]
    const key = fundMapKey(s.ticker)
    const f = fundamentalsByTicker.get(key)
    const cachedPick = pickNarratives.get(key)
    if (cachedPick) {
      reasons[key] = {
        company_blurb: cachedPick.company_blurb ?? '',
        thesis: cachedPick.thesis,
        main_risk: cachedPick.main_risk,
        narrative_source: 'llm',
      }
      continue
    }

    const pick = f ? trendingToScoredPick(s, f) : null
    const mech = pick ? { ...mechanicalNarrativeSync(pick), narrative_source: 'mechanical' as const } : null

    if (llmEnabled && pick && f) {
      if (i > 0) await new Promise((r) => setTimeout(r, LLM_BLURB_DELAY_MS))
      const headlines = (headlinesMap.get(key) ?? []).map((n) => n.title)
      const narrative = await generateNarrativeForPick(pick, f, headlines)
      if (narrative.narrative_source === 'llm') {
        await persistPickNarrative(supabase, s.ticker, narrative, 'watchlist/suggestions')
        reasons[key] = narrative
        continue
      }
    }

    if (mech) reasons[key] = mech
  }

  for (const s of ranked.slice(LLM_BLURB_COUNT)) {
    const key = fundMapKey(s.ticker)
    if (cachedToNarrative(reasons[key])) continue
    const mech = mechanicalCached(s, fundamentalsByTicker.get(key))
    if (mech) reasons[key] = mech
  }

  return reasons
}

async function buildGlobalRanked(
  supabase: ReturnType<typeof createServerClient>,
  existingReasons: Record<string, CachedReason>,
): Promise<CachedPayload> {
  const candidates = await fetchTrendingCandidates(CANDIDATE_POOL)
  const tickers = candidates.map((m) => m.ticker)

  const { data: rows } = await supabase.from('stock_fundamentals').select('*').in('ticker', tickers)

  const fundamentalsByTicker = normalizeFundamentalsMap((rows ?? []) as StockFundamentals[])

  const missing = tickers.filter((t) => !fundamentalsByTicker.has(fundMapKey(t)))
  if (missing.length) {
    const fetched = await mapPool(missing, 6, fetchStockFundamentals)
    missing.forEach((t, i) => {
      fundamentalsByTicker.set(fundMapKey(t), fetched[i])
    })
    await supabase.from('stock_fundamentals').upsert(
      fetched.map((f) => ({ ...f, fetched_at: new Date().toISOString() })),
      { onConflict: 'ticker' },
    )
  }

  const sectorLoaded = await ensureSectorBenchmarksLoaded(supabase)
  const sectorCache = {
    benchmarks: sectorLoaded.benchmarks,
    stale: sectorLoaded.refreshing,
    tableMissing: sectorLoaded.tableMissing,
  }

  const scored: ScoredSuggestion[] = []
  for (const mover of candidates) {
    let sectorDayDelta: number | null = null
    if (isBenchmarkableSector(mover.sector)) {
      const bench = sectorCache.benchmarks[mover.sector as BenchmarkableSector]
      if (bench?.change_1d_pct != null) {
        sectorDayDelta = mover.change_1d_pct - bench.change_1d_pct
      }
    }

    const row = scoreTrendingCandidate({
      mover,
      fundamentals: fundamentalsByTicker.get(fundMapKey(mover.ticker)) ?? null,
      sectorDayDelta,
    })
    if (row) scored.push(row)
  }

  const ranked = rankTrendingSuggestions(scored, TRENDING_GLOBAL_RANK_LIMIT)
  void ensureLogosForTickers(
    supabase,
    ranked.map((s) => s.ticker),
  ).catch(() => {})
  await Promise.all(
    ranked.map(async (s) => {
      if (s.sector !== 'Other') return
      const sector = await fetchYahooSector(s.ticker)
      if (sector) s.sector = sector
    }),
  )
  const reasons = await enrichWithBlurbs(supabase, ranked, existingReasons, fundamentalsByTicker)
  const generated_at = new Date().toISOString()

  const payload: CachedPayload = {
    ranked,
    reasons,
    generated_at,
    narrative_version: TRENDING_NARRATIVE_VERSION,
  }

  const { error: cacheWriteError } = await supabase.from('watchlist_suggestions_cache').upsert(
    {
      cache_key: 'global',
      suggestions: payload,
      generated_at,
    },
    { onConflict: 'cache_key' },
  )
  if (cacheWriteError) {
    console.warn('[watchlist/suggestions] cache upsert failed:', cacheWriteError.message)
  } else {
    const llmCount = Object.values(reasons).filter((r) => r.narrative_source === 'llm').length
    console.info(`[watchlist/suggestions] rebuilt trending rankings; ${llmCount} LLM blurbs in cache`)
  }

  return payload
}

function resolveNarrative(
  s: ScoredSuggestion,
  pickNarrative: PickNarrativePayload | undefined,
  fundamentals: StockFundamentals | undefined,
  cachedReason?: CachedReason | LegacyCachedReason,
): CachedReason {
  if (pickNarrative?.narrative_source === 'llm') {
    return {
      company_blurb: pickNarrative.company_blurb ?? '',
      thesis: pickNarrative.thesis,
      main_risk: pickNarrative.main_risk,
      narrative_source: 'llm',
    }
  }

  const mech = mechanicalCached(s, fundamentals)
  if (mech) return mech

  const fromCache = cachedToNarrative(cachedReason)
  if (fromCache) return fromCache

  return {
    company_blurb: '',
    thesis: 'Signals are still loading for this name.',
    main_risk: 'Trending names can reverse quickly after a hot session.',
    narrative_source: 'mechanical',
  }
}

function toSuggestion(
  s: ScoredSuggestion,
  pickNarrative: PickNarrativePayload | undefined,
  fundamentals: StockFundamentals | undefined,
  cachedReason?: CachedReason | LegacyCachedReason,
): WatchlistSuggestion {
  const narrative = resolveNarrative(s, pickNarrative, fundamentals, cachedReason)
  return {
    ticker: s.ticker,
    company_name: s.company_name,
    sector: s.sector,
    current_price: s.current_price,
    change_1d_pct: s.change_1d_pct,
    change_30d_pct: s.change_30d_pct,
    upside_pct: s.upside_pct,
    analyst_buy: s.analyst_buy,
    analyst_total: s.analyst_total,
    score: s.score,
    headline: s.headline,
    company_blurb: narrative.company_blurb,
    thesis: narrative.thesis,
    main_risk: narrative.main_risk,
    reason: `${narrative.company_blurb} ${narrative.thesis}`,
    narrative_source: narrative.narrative_source,
  }
}

async function overlayLivePrices(
  suggestions: WatchlistSuggestion[],
): Promise<WatchlistSuggestion[]> {
  if (!suggestions.length) return suggestions

  const live = await fetchLivePricesForTickers(suggestions.map((s) => s.ticker))
  if (!live.size) return suggestions

  return suggestions.map((s) => {
    const snap = live.get(s.ticker)
    if (!snap) return s
    const buyRatio = s.analyst_total > 0 ? s.analyst_buy / s.analyst_total : 0
    return {
      ...s,
      current_price: snap.price,
      change_1d_pct: snap.change_1d_pct,
      headline: trendingHeadline(snap.change_1d_pct, buyRatio),
    }
  })
}

export async function GET(req: NextRequest) {
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1'
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  const supabase = createServerClient()

  const { data: watchlist } = await supabase
    .from('watchlist_stocks')
    .select('ticker')
    .eq('user_id', userId)

  const owned = new Set((watchlist ?? []).map((w) => String(w.ticker).toUpperCase()))

  const stored = await loadStoredPayload(supabase)
  const useStoredRankings = stored && isPayloadFresh(stored) && !forceRefresh

  let cached: CachedPayload
  if (useStoredRankings) {
    cached = stored
  } else {
    try {
      const keepReasons =
        stored?.narrative_version === TRENDING_NARRATIVE_VERSION ? stored.reasons ?? {} : {}
      cached = await buildGlobalRanked(supabase, keepReasons)
    } catch (err) {
      console.error('[watchlist/suggestions] build failed:', err)
      const empty: WatchlistSuggestionsResponse = {
        suggestions: [],
        generated_at: new Date().toISOString(),
        llm_enabled: isLLMEnabled(),
        scanned_count: 0,
      }
      return NextResponse.json(empty, { headers: NO_CACHE })
    }
  }

  const notOnWatchlist = cached.ranked.filter((s) => !owned.has(s.ticker.toUpperCase()))
  const top = notOnWatchlist.slice(0, USER_TRENDING_LIMIT)

  const tickers = top.map((s) => s.ticker)
  const { data: fundRows } = await supabase.from('stock_fundamentals').select('*').in('ticker', tickers)
  const fundamentalsByTicker = normalizeFundamentalsMap((fundRows ?? []) as StockFundamentals[])
  const missingFundTickers = tickers.filter((t) => !fundamentalsByTicker.has(fundMapKey(t)))
  if (missingFundTickers.length) {
    const fetched = await mapPool(missingFundTickers, 3, fetchStockFundamentals)
    missingFundTickers.forEach((t, i) => {
      fundamentalsByTicker.set(fundMapKey(t), fetched[i])
    })
  }

  const pickNarratives = await loadCachedPickNarratives(
    supabase,
    tickers,
    'watchlist/suggestions',
  )

  const pendingPicks: ScoredPick[] = []
  for (const s of top) {
    const key = fundMapKey(s.ticker)
    if (pickNarratives.has(key)) continue
    const f = fundamentalsByTicker.get(key)
    if (!f) continue
    if (f) pendingPicks.push(trendingToScoredPick(s, f))
  }
  if (pendingPicks.length && isLLMEnabled()) {
    schedulePickNarrativeGeneration(
      supabase,
      pendingPicks,
      fundamentalsByTicker,
      'watchlist/suggestions',
    )
  }

  let suggestions: WatchlistSuggestion[] = top.map((s) => {
    const key = fundMapKey(s.ticker)
    const pickNarrative = pickNarratives.get(key)
    return toSuggestion(
      s,
      pickNarrative ? rowToNarrativePayload(pickNarrative) : undefined,
      fundamentalsByTicker.get(key),
      cached.reasons[key] ?? cached.reasons[s.ticker],
    )
  })

  suggestions = await overlayLivePrices(suggestions)

  const response: WatchlistSuggestionsResponse = {
    suggestions,
    generated_at: cached.generated_at,
    llm_enabled: isLLMEnabled(),
    scanned_count: cached.ranked.length,
  }

  return NextResponse.json(response, {
    headers: {
      ...NO_CACHE,
      'X-Market-Open': isPriceRefreshActive() ? '1' : '0',
    },
  })
}
