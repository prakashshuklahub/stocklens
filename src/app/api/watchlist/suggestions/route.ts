// GET /api/watchlist/suggestions — trending cards ("not on your list").
//
// Candidate source: Yahoo market movers only (see trending-candidates.ts).
// Scoring: watchlist-suggestions-scoring.ts (no watchlist awareness).
// Per-user filter: drop tickers already on the user's watchlist — only filter here.

import { auth, getSessionUserId } from '@/lib/auth'
import { fetchStockFundamentals, mapPool } from '@/lib/fundamentals-fetch'
import { fetchLivePricesForTickers } from '@/lib/live-prices'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
import { fetchYahooSector } from '@/lib/sectors'
import { fetchTrendingCandidates } from '@/lib/trending-candidates'
import {
  ensureSectorBenchmarksLoaded,
} from '@/lib/sector-benchmarks'
import { isBenchmarkableSector, type BenchmarkableSector } from '@/lib/sector-relative-strength-scoring'
import { generateSuggestionNarrative, isLLMEnabled } from '@/lib/llm'
import { NARRATIVE_TTL_HOURS } from '@/lib/narrative-cache'
import {
  rankTrendingSuggestions,
  scoreTrendingCandidate,
  trendingHeadline,
  TRENDING_GLOBAL_RANK_LIMIT,
  type ScoredSuggestion,
} from '@/lib/watchlist-suggestions-scoring'
import {
  isRedundantNarrative,
  loadSuggestionBlurbExtras,
  mechanicalTrendingNarrative,
  suggestionNarrativeContext,
  type SuggestionBlurbExtras,
} from '@/lib/watchlist-suggestions'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import type { StockFundamentals, TrendingNarrative, WatchlistSuggestion, WatchlistSuggestionsResponse } from '@/types'

const TRENDING_CACHE_HOURS = NARRATIVE_TTL_HOURS
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

function cachedToNarrative(
  cached: CachedReason | LegacyCachedReason | undefined,
): CachedReason | null {
  if (!cached) return null
  if ('thesis' in cached && cached.company_blurb?.trim() && cached.thesis?.trim() && cached.main_risk?.trim()) {
    return cached as CachedReason
  }
  return null
}

function narrativesMatch(a: TrendingNarrative, b: TrendingNarrative): boolean {
  return (
    a.company_blurb === b.company_blurb &&
    a.thesis === b.thesis &&
    a.main_risk === b.main_risk
  )
}

function mechanicalCached(s: ScoredSuggestion, extras?: SuggestionBlurbExtras): CachedReason {
  return { ...mechanicalTrendingNarrative(s, extras), narrative_source: 'mechanical' }
}

type CachedPayload = {
  ranked: ScoredSuggestion[]
  reasons: Record<string, CachedReason>
  generated_at: string
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
  }
}

function isPayloadFresh(generatedAt: string): boolean {
  const cutoff = Date.now() - TRENDING_CACHE_HOURS * 3600 * 1000
  return new Date(generatedAt).getTime() >= cutoff
}

async function enrichWithBlurbs(
  ranked: ScoredSuggestion[],
  existing: Record<string, CachedReason>,
): Promise<Record<string, CachedReason>> {
  const reasons = { ...existing }
  const llmEnabled = isLLMEnabled()
  const targets = ranked.slice(0, LLM_BLURB_COUNT)
  const extrasByTicker = await loadSuggestionBlurbExtras(targets)

  for (let i = 0; i < targets.length; i++) {
    const s = targets[i]
    const key = s.ticker.toUpperCase()
    const extras = extrasByTicker.get(key)
    const mech = mechanicalCached(s, extras)
    const cached = reasons[key] ?? reasons[s.ticker]
    const existing = cachedToNarrative(cached)
    const staleBlurb =
      !existing ||
      isRedundantNarrative(s, existing, extras) ||
      (cached?.narrative_source === 'mechanical' && !narrativesMatch(existing, mech))
    if (cached?.narrative_source === 'llm' && !staleBlurb) continue

    if (llmEnabled) {
      if (i > 0) await new Promise((r) => setTimeout(r, LLM_BLURB_DELAY_MS))
      const narrative = await generateSuggestionNarrative(suggestionNarrativeContext(s, extras))
      if (narrative && !isRedundantNarrative(s, narrative, extras)) {
        reasons[key] = { ...narrative, narrative_source: 'llm' }
        continue
      }
    }

    reasons[key] = mech
  }

  for (const s of ranked.slice(LLM_BLURB_COUNT)) {
    const key = s.ticker.toUpperCase()
    const extras = extrasByTicker.get(key)
    const mech = mechanicalCached(s, extras)
    const existing = cachedToNarrative(reasons[key])
    if (existing && !isRedundantNarrative(s, existing, extras)) continue
    reasons[key] = mech
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

  const fundamentalsByTicker = new Map<string, StockFundamentals>()
  for (const row of (rows ?? []) as StockFundamentals[]) {
    fundamentalsByTicker.set(row.ticker, row)
  }

  const missing = tickers.filter((t) => !fundamentalsByTicker.has(t))
  if (missing.length) {
    const fetched = await mapPool(missing, 6, fetchStockFundamentals)
    missing.forEach((t, i) => {
      fundamentalsByTicker.set(t, fetched[i])
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
      fundamentals: fundamentalsByTicker.get(mover.ticker) ?? null,
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
  const reasons = await enrichWithBlurbs(ranked, existingReasons)
  const generated_at = new Date().toISOString()

  const payload: CachedPayload = { ranked, reasons, generated_at }

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
  cached: CachedReason | LegacyCachedReason | undefined,
  extras?: SuggestionBlurbExtras,
): CachedReason {
  const mech = mechanicalCached(s, extras)
  const existing = cachedToNarrative(cached)
  if (!existing) return mech
  if (isRedundantNarrative(s, existing, extras)) return mech
  if (existing.narrative_source === 'mechanical') return mech
  return existing
}

/** Regenerate weak cached blurbs with Gemini on read (visible cards only). */
async function ensureQualityBlurbs(
  top: ScoredSuggestion[],
  reasons: Record<string, CachedReason | LegacyCachedReason>,
  extrasByTicker: Map<string, SuggestionBlurbExtras>,
): Promise<Record<string, CachedReason>> {
  const out: Record<string, CachedReason> = {}
  for (const [key, value] of Object.entries(reasons)) {
    const normalized = cachedToNarrative(value)
    if (normalized) out[key] = normalized
  }
  if (!isLLMEnabled() || !top.length) {
    for (const s of top) {
      const key = s.ticker.toUpperCase()
      if (!out[key]) out[key] = mechanicalCached(s, extrasByTicker.get(key))
    }
    return out
  }

  for (let i = 0; i < top.length; i++) {
    const s = top[i]
    const key = s.ticker.toUpperCase()
    const extras = extrasByTicker.get(key)
    const preview = resolveNarrative(s, out[key] ?? reasons[key], extras)
    if (!isRedundantNarrative(s, preview, extras)) {
      out[key] = preview
      continue
    }

    if (i > 0) await new Promise((r) => setTimeout(r, LLM_BLURB_DELAY_MS))
    const narrative = await generateSuggestionNarrative(suggestionNarrativeContext(s, extras))
    if (narrative && !isRedundantNarrative(s, narrative, extras)) {
      out[key] = { ...narrative, narrative_source: 'llm' }
      continue
    }

    const mech = mechanicalCached(s, extras)
    if (!isRedundantNarrative(s, mech, extras)) {
      out[key] = mech
    }
  }

  for (const s of top) {
    const key = s.ticker.toUpperCase()
    if (!out[key]) out[key] = mechanicalCached(s, extrasByTicker.get(key))
  }

  return out
}

function toSuggestion(
  s: ScoredSuggestion,
  cached: CachedReason | LegacyCachedReason | undefined,
  extras?: SuggestionBlurbExtras,
): WatchlistSuggestion {
  const narrative = resolveNarrative(s, cached, extras)
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
  const useStoredRankings = stored && isPayloadFresh(stored.generated_at) && !forceRefresh

  let cached: CachedPayload
  if (useStoredRankings) {
    cached = stored
  } else {
    try {
      cached = await buildGlobalRanked(supabase, stored?.reasons ?? {})
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

  // Only per-user filter: exclude tickers already on this user's watchlist.
  const notOnWatchlist = cached.ranked.filter((s) => !owned.has(s.ticker.toUpperCase()))
  const top = notOnWatchlist.slice(0, USER_TRENDING_LIMIT)
  const extrasByTicker = await loadSuggestionBlurbExtras(top)
  const reasons = await ensureQualityBlurbs(top, cached.reasons, extrasByTicker)

  let suggestions: WatchlistSuggestion[] = top.map((s) => {
    const key = s.ticker.toUpperCase()
    return toSuggestion(
      s,
      reasons[key] ?? reasons[s.ticker],
      extrasByTicker.get(key),
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
