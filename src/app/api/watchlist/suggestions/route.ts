import { auth } from '@/lib/auth'
import { fetchStockFundamentals, mapPool } from '@/lib/fundamentals-fetch'
import { fetchYahooSector } from '@/lib/sectors'
import { fetchMarketMovers } from '@/lib/market-movers'
import { generateSuggestionBlurb, isLLMEnabled } from '@/lib/llm'
import {
  isRedundantBlurb,
  mechanicalReason,
  rankSuggestions,
  scoreSuggestion,
  suggestionBlurbContext,
  type ScoredSuggestion,
} from '@/lib/watchlist-suggestions'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import type { StockFundamentals, WatchlistSuggestion, WatchlistSuggestionsResponse } from '@/types'

const CACHE_HOURS = 6
const CANDIDATE_POOL = 40
const GLOBAL_TOP = 15
const USER_TOP = 3
const LLM_BLURB_COUNT = 3
const LLM_BLURB_DELAY_MS = 500
const NO_CACHE = { 'Cache-Control': 'private, no-store, max-age=0' } as const

export type CachedReason = {
  reason: string
  narrative_source: 'llm' | 'mechanical'
}

type CachedPayload = {
  ranked: ScoredSuggestion[]
  reasons: Record<string, CachedReason>
  generated_at: string
}

async function loadGlobalCache(
  supabase: ReturnType<typeof createServerClient>,
  forceRefresh: boolean,
): Promise<CachedPayload | null> {
  if (forceRefresh) return null

  const { data, error } = await supabase
    .from('watchlist_suggestions_cache')
    .select('suggestions, generated_at')
    .eq('cache_key', 'global')
    .maybeSingle()

  if (error || !data) return null

  const cutoff = Date.now() - CACHE_HOURS * 3600 * 1000
  if (new Date(data.generated_at).getTime() < cutoff) return null

  const raw = data.suggestions as CachedPayload | ScoredSuggestion[]
  if (!raw) return null

  // Back-compat: old cache was only an array
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

async function enrichWithBlurbs(
  ranked: ScoredSuggestion[],
  existing: Record<string, CachedReason>,
  forceLlm: boolean,
): Promise<Record<string, CachedReason>> {
  const reasons = { ...existing }
  const llmEnabled = isLLMEnabled()
  const targets = ranked.slice(0, LLM_BLURB_COUNT)

  // Sequential calls — avoids Gemini 429 when Picks/Signals run at the same time
  for (let i = 0; i < targets.length; i++) {
    const s = targets[i]
    const cached = reasons[s.ticker]
    const staleBlurb =
      cached?.reason &&
      (isRedundantBlurb(s, cached.reason) ||
        (cached.narrative_source === 'mechanical' && cached.reason !== mechanicalReason(s)))
    if (!forceLlm && cached?.narrative_source === 'llm' && !staleBlurb) continue

    if (llmEnabled) {
      if (i > 0) await new Promise((r) => setTimeout(r, LLM_BLURB_DELAY_MS))
      const blurb = await generateSuggestionBlurb(suggestionBlurbContext(s))
      if (blurb && !isRedundantBlurb(s, blurb.reason)) {
        reasons[s.ticker] = { reason: blurb.reason, narrative_source: 'llm' }
        continue
      }
    }

    reasons[s.ticker] = { reason: mechanicalReason(s), narrative_source: 'mechanical' }
  }

  return reasons
}

async function buildGlobalRanked(
  supabase: ReturnType<typeof createServerClient>,
  forceLlm: boolean,
): Promise<CachedPayload> {
  const movers = await fetchMarketMovers(CANDIDATE_POOL)
  const tickers = movers.map((m) => m.ticker)

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

  const scored: ScoredSuggestion[] = []
  for (const mover of movers) {
    const s = scoreSuggestion(mover, fundamentalsByTicker.get(mover.ticker) ?? null)
    if (s) scored.push(s)
  }

  const ranked = rankSuggestions(scored, GLOBAL_TOP)
  await Promise.all(
    ranked.map(async (s) => {
      if (s.sector !== 'Other') return
      const sector = await fetchYahooSector(s.ticker)
      if (sector) s.sector = sector
    }),
  )
  const reasons = await enrichWithBlurbs(ranked, {}, forceLlm)
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
  }

  return payload
}

function resolveNarrative(s: ScoredSuggestion, cached: CachedReason | undefined): CachedReason {
  const stale =
    cached?.reason &&
    (isRedundantBlurb(s, cached.reason) ||
      (cached.narrative_source === 'mechanical' && cached.reason !== mechanicalReason(s)))
  if (!cached || stale) {
    return { reason: mechanicalReason(s), narrative_source: 'mechanical' }
  }
  if (cached.narrative_source === 'mechanical') {
    return { reason: mechanicalReason(s), narrative_source: 'mechanical' }
  }
  return cached
}

function toSuggestion(s: ScoredSuggestion, cached: CachedReason | undefined): WatchlistSuggestion {
  const narrative = resolveNarrative(s, cached)
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
    reason: narrative.reason,
    narrative_source: narrative.narrative_source,
  }
}

export async function GET(req: NextRequest) {
  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1'
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()

  const { data: watchlist } = await supabase
    .from('watchlist_stocks')
    .select('ticker')
    .eq('user_id', session.user.id)

  const owned = new Set((watchlist ?? []).map((w) => String(w.ticker).toUpperCase()))

  let cached = await loadGlobalCache(supabase, forceRefresh)
  if (!cached) {
    try {
      cached = await buildGlobalRanked(supabase, forceRefresh)
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

  const available = cached.ranked.filter((s) => !owned.has(s.ticker))
  const top = available.slice(0, USER_TOP)

  const suggestions: WatchlistSuggestion[] = top.map((s) =>
    toSuggestion(s, cached!.reasons[s.ticker]),
  )

  const response: WatchlistSuggestionsResponse = {
    suggestions,
    generated_at: cached.generated_at,
    llm_enabled: isLLMEnabled(),
    scanned_count: cached.ranked.length,
  }

  return NextResponse.json(response, { headers: NO_CACHE })
}
