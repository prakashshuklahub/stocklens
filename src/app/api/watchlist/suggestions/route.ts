import { auth, getSessionUserId } from '@/lib/auth'
import { fetchStockFundamentals, mapPool } from '@/lib/fundamentals-fetch'
import { fetchLivePricesForTickers } from '@/lib/live-prices'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
import { fetchYahooSector } from '@/lib/sectors'
import { fetchMarketMovers } from '@/lib/market-movers'
import { generateSuggestionBlurb, isLLMEnabled } from '@/lib/llm'
import { NARRATIVE_TTL_HOURS } from '@/lib/narrative-cache'
import {
  isRedundantBlurb,
  mechanicalReason,
  rankSuggestions,
  scoreSuggestion,
  suggestionBlurbContext,
  suggestionHeadline,
  type ScoredSuggestion,
} from '@/lib/watchlist-suggestions'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import type { StockFundamentals, WatchlistSuggestion, WatchlistSuggestionsResponse } from '@/types'

const CACHE_HOURS = NARRATIVE_TTL_HOURS
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
  const cutoff = Date.now() - CACHE_HOURS * 3600 * 1000
  return new Date(generatedAt).getTime() >= cutoff
}

async function enrichWithBlurbs(
  ranked: ScoredSuggestion[],
  existing: Record<string, CachedReason>,
): Promise<Record<string, CachedReason>> {
  const reasons = { ...existing }
  const llmEnabled = isLLMEnabled()
  const targets = ranked.slice(0, LLM_BLURB_COUNT)

  // Sequential calls — avoids Gemini 429 when Picks/Signals run at the same time
  for (let i = 0; i < targets.length; i++) {
    const s = targets[i]
    const key = s.ticker.toUpperCase()
    const cached = reasons[key] ?? reasons[s.ticker]
    const staleBlurb =
      cached?.reason &&
      (isRedundantBlurb(s, cached.reason) ||
        (cached.narrative_source === 'mechanical' && cached.reason !== mechanicalReason(s)))
    if (cached?.narrative_source === 'llm' && !staleBlurb) continue

    if (llmEnabled) {
      if (i > 0) await new Promise((r) => setTimeout(r, LLM_BLURB_DELAY_MS))
      const blurb = await generateSuggestionBlurb(suggestionBlurbContext(s))
      if (blurb && !isRedundantBlurb(s, blurb.reason)) {
        reasons[key] = { reason: blurb.reason, narrative_source: 'llm' }
        continue
      }
    }

    reasons[key] = { reason: mechanicalReason(s), narrative_source: 'mechanical' }
  }

  return reasons
}

async function buildGlobalRanked(
  supabase: ReturnType<typeof createServerClient>,
  existingReasons: Record<string, CachedReason>,
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
    console.info(`[watchlist/suggestions] rebuilt rankings; ${llmCount} LLM blurbs in cache`)
  }

  return payload
}

function resolveNarrative(s: ScoredSuggestion, cached: CachedReason | undefined): CachedReason {
  const resolved = cached ?? undefined
  const stale =
    resolved?.reason &&
    (isRedundantBlurb(s, resolved.reason) ||
      (resolved.narrative_source === 'mechanical' && resolved.reason !== mechanicalReason(s)))
  if (!resolved || stale) {
    return { reason: mechanicalReason(s), narrative_source: 'mechanical' }
  }
  if (resolved.narrative_source === 'mechanical') {
    return { reason: mechanicalReason(s), narrative_source: 'mechanical' }
  }
  return resolved
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

/** Same Yahoo source as watchlist — live when open, last close when closed. */
async function overlayLivePrices(
  suggestions: WatchlistSuggestion[],
): Promise<WatchlistSuggestion[]> {
  if (!suggestions.length) return suggestions

  const live = await fetchLivePricesForTickers(suggestions.map((s) => s.ticker))
  if (!live.size) return suggestions

  return suggestions.map((s) => {
    const snap = live.get(s.ticker)
    if (!snap) return s
    return {
      ...s,
      current_price: snap.price,
      change_1d_pct: snap.change_1d_pct,
      headline: suggestionHeadline(snap.change_1d_pct),
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

  const available = cached.ranked.filter((s) => !owned.has(s.ticker))
  const top = available.slice(0, USER_TOP)

  let suggestions: WatchlistSuggestion[] = top.map((s) => {
    const key = s.ticker.toUpperCase()
    return toSuggestion(s, cached!.reasons[key] ?? cached!.reasons[s.ticker])
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
