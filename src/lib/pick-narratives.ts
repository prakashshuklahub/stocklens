import { generateNarrative, isLLMEnabled } from '@/lib/llm'
import {
  loadFreshNarratives,
  mapSequential,
  MECHANICAL_MODEL,
  narrativeSourceFromModel,
  upsertNarratives,
} from '@/lib/narrative-cache'
import { mechanicalThesis, type ScoredPick } from '@/lib/picks'
import type { createServerClient } from '@/lib/supabase'
import type { Pick, PickNarrativePayload, SignalNewsItem, StockFundamentals } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

export type PickNarrativeRow = {
  ticker: string
  thesis: string
  main_risk: string
  model: string | null
  generated_at: string
}

export type { PickNarrativePayload }

export async function loadCachedPickNarratives(
  supabase: Supabase,
  tickers: string[],
  logPrefix: string,
): Promise<Map<string, PickNarrativeRow>> {
  const cached = await loadFreshNarratives<PickNarrativeRow>(
    supabase,
    'pick_narratives',
    tickers,
    logPrefix,
  )

  if (isLLMEnabled()) {
    for (const [ticker, row] of cached) {
      if (row.model === MECHANICAL_MODEL) cached.delete(ticker)
    }
  }

  return cached
}

export function rowToNarrativePayload(row: PickNarrativeRow): PickNarrativePayload {
  return {
    thesis: row.thesis,
    main_risk: row.main_risk,
    narrative_source: narrativeSourceFromModel(row.model),
    narrative_generated_at: row.generated_at,
  }
}

/** Cached LLM or mechanical fallback — never blocks on Gemini. */
export function attachPickNarratives(
  top: ScoredPick[],
  cachedByTicker: Map<string, PickNarrativeRow>,
  newsByTicker: Map<string, SignalNewsItem[]>,
  scoresAt: string,
): { picks: Pick[]; narrativeTimes: string[]; pendingLlm: ScoredPick[] } {
  if (!top.length) return { picks: [], narrativeTimes: [], pendingLlm: [] }

  const llmEnabled = isLLMEnabled()
  const pendingLlm: ScoredPick[] = []
  const narrativeTimes: string[] = []

  const picks: Pick[] = top.map((p) => {
    const key = p.ticker.toUpperCase()
    const cached = cachedByTicker.get(key)

    if (cached) {
      narrativeTimes.push(cached.generated_at)
      return {
        ...p,
        thesis: cached.thesis,
        main_risk: cached.main_risk,
        narrative_source: narrativeSourceFromModel(cached.model),
        narrative_generated_at: cached.generated_at,
        news: newsByTicker.get(key) ?? [],
      }
    }

    const fallback = mechanicalThesis(p)
    if (llmEnabled) pendingLlm.push(p)

    return {
      ...p,
      thesis: fallback.thesis,
      main_risk: fallback.main_risk,
      narrative_source: 'mechanical' as const,
      narrative_generated_at: scoresAt,
      news: newsByTicker.get(key) ?? [],
    }
  })

  return { picks, narrativeTimes, pendingLlm }
}

async function generateAndUpsertPickNarratives(
  supabase: Supabase,
  pending: ScoredPick[],
  fundamentalsByTicker: Map<string, StockFundamentals>,
  newsByTicker: Map<string, SignalNewsItem[]>,
  logPrefix: string,
): Promise<void> {
  type GenResult = {
    ticker: string
    thesis: string
    main_risk: string
    source: 'llm' | 'mechanical'
    model: string | null
  }

  const generated = await mapSequential(pending, async (pick): Promise<GenResult> => {
    const f = fundamentalsByTicker.get(pick.ticker)
    const headlines = (newsByTicker.get(pick.ticker.toUpperCase()) ?? []).map((n) => n.title)

    if (f) {
      const narrative = await generateNarrative({
        ticker: pick.ticker,
        company_name: pick.company_name,
        sector: pick.sector,
        target_label: pick.target_label,
        current_price: pick.current_price,
        target_mean: pick.target_mean,
        target_low: pick.target_low,
        target_high: pick.target_high,
        upside_pct: pick.upside_pct,
        analyst_buy: pick.analyst_buy,
        analyst_hold: pick.analyst_hold,
        analyst_sell: pick.analyst_sell,
        analyst_total: pick.analyst_total,
        change_7d_pct: f.change_7d_pct,
        change_30d_pct: f.change_30d_pct,
        week52_high: f.week52_high,
        week52_low: f.week52_low,
        news_sentiment: f.news_sentiment,
        factors: pick.factors.map((x) => x.label),
        recent_headlines: headlines,
      })

      if (narrative) {
        return {
          ticker: pick.ticker,
          thesis: narrative.thesis,
          main_risk: narrative.main_risk,
          source: 'llm',
          model: narrative.model,
        }
      }
    }

    const fallback = mechanicalThesis(pick)
    return { ticker: pick.ticker, ...fallback, source: 'mechanical', model: null }
  })

  if (!generated.length) return

  const narrativeRows = generated.map((g) => ({
    ticker: g.ticker.toUpperCase(),
    thesis: g.thesis,
    main_risk: g.main_risk,
    model: g.source === 'llm' && g.model ? g.model : MECHANICAL_MODEL,
    generated_at: new Date().toISOString(),
  }))

  await upsertNarratives(supabase, 'pick_narratives', narrativeRows, logPrefix)
}

/** Fire-and-forget Gemini generation for cache misses (does not block the HTTP response). */
export function schedulePickNarrativeGeneration(
  supabase: Supabase,
  pending: ScoredPick[],
  fundamentalsByTicker: Map<string, StockFundamentals>,
  logPrefix: string,
): void {
  if (!pending.length || !isLLMEnabled()) return

  console.info(`[${logPrefix}] scheduling ${pending.length} narrative(s) in background`)

  void (async () => {
    const { fetchPickHeadlinesForTickers } = await import('@/lib/pick-headlines')
    const newsByTicker = await fetchPickHeadlinesForTickers(pending.map((p) => p.ticker))
    await generateAndUpsertPickNarratives(
      supabase,
      pending,
      fundamentalsByTicker,
      newsByTicker,
      logPrefix,
    )
  })().catch((err) => {
    console.warn(`[${logPrefix}] background narrative generation failed:`, err)
  })
}
