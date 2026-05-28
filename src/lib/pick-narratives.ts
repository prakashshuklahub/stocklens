import { isLLMEnabled } from '@/lib/llm'
import { getCronWindowStatus, isCronWorkAllowed, logCronWindowSkip } from '@/lib/cron/window'
import {
  loadFreshNarratives,
  mapSequential,
  MECHANICAL_MODEL,
  narrativeSourceFromModel,
  upsertNarratives,
} from '@/lib/narrative-cache'
import { mechanicalThesis, type ScoredPick } from '@/lib/picks'
import { generateNarrativeForPick } from '@/lib/stock-narratives'
import type { createServerClient } from '@/lib/supabase'
import type { Pick, PickNarrativePayload, SignalNewsItem, StockFundamentals } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

export type PickNarrativeRow = {
  ticker: string
  company_blurb: string | null
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
      if (row.model === MECHANICAL_MODEL || !row.company_blurb?.trim()) {
        cached.delete(ticker)
      }
    }
  }

  return cached
}

export function rowToNarrativePayload(row: PickNarrativeRow): PickNarrativePayload {
  return {
    company_blurb: row.company_blurb,
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
        company_blurb: cached.company_blurb,
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
      company_blurb: fallback.company_blurb,
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
  const generated = await mapSequential(pending, async (pick) => {
    const f = fundamentalsByTicker.get(pick.ticker)
    const headlines = (newsByTicker.get(pick.ticker.toUpperCase()) ?? []).map((n) => n.title)
    const narrative = await generateNarrativeForPick(pick, f, headlines)
    return {
      ticker: pick.ticker,
      company_blurb: narrative.company_blurb,
      thesis: narrative.thesis,
      main_risk: narrative.main_risk,
      source: narrative.narrative_source,
      model: narrative.model,
    }
  })

  if (!generated.length) return

  const narrativeRows = generated.map((g) => ({
    ticker: g.ticker.toUpperCase(),
    company_blurb: g.company_blurb,
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

  if (!isCronWorkAllowed()) {
    const status = getCronWindowStatus()
    if (!status.allowed) logCronWindowSkip(logPrefix, status)
    return
  }

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
