/** Shared What they do / Why it looks good / Main thing to watch — Picks + trending cards. */

import { fetchYahooBusinessSummary, mechanicalCompanyBlurb } from '@/lib/company-profile'
import { generateNarrative } from '@/lib/llm'
import { mechanicalThesis } from '@/lib/picks'
import {
  buildNarrativeScoredPick,
  scoreDiscoveryPick,
  type ScoredPick,
} from '@/lib/picks-scoring'
import type { ScoredSuggestion } from '@/lib/watchlist-suggestions-scoring'
import type { createServerClient } from '@/lib/supabase'
import type { Pick, PickFactor, StockFundamentals, TrendingNarrative } from '@/types'

type Supabase = ReturnType<typeof createServerClient>

export type GeneratedNarrative = TrendingNarrative & {
  narrative_source: 'llm' | 'mechanical'
  model: string | null
}

export function trendingToScoredPick(
  suggestion: ScoredSuggestion,
  fundamentals: StockFundamentals,
): ScoredPick {
  const mover = {
    ticker: suggestion.ticker,
    company_name: suggestion.company_name,
    sector: suggestion.sector,
    price: suggestion.current_price,
    change_1d_pct: suggestion.change_1d_pct,
    source: suggestion.source,
  }

  return (
    scoreDiscoveryPick({
      mover,
      current_price: suggestion.current_price,
      change_1d_pct: suggestion.change_1d_pct,
      fundamentals,
    }) ??
    buildNarrativeScoredPick({
      candidate: {
        ticker: suggestion.ticker,
        company_name: suggestion.company_name,
        sector: suggestion.sector,
        source: 'discovery',
      },
      current_price: suggestion.current_price,
      change_1d_pct: suggestion.change_1d_pct,
      fundamentals,
      ownership: null,
    }) ??
    syntheticTrendingNarrativePick(suggestion, fundamentals)
  )
}

/** When Picks gates fail (e.g. price above target after a big rally), still build narrative input. */
function syntheticTrendingNarrativePick(
  suggestion: ScoredSuggestion,
  fundamentals: StockFundamentals,
): ScoredPick {
  const price = suggestion.current_price
  const factors: PickFactor[] = []

  if (suggestion.change_1d_pct >= 8) {
    factors.push({
      label: 'Big move today',
      value: `+${suggestion.change_1d_pct.toFixed(1)}% today`,
      tone: 'positive',
    })
  } else if (suggestion.change_1d_pct >= 3) {
    factors.push({ label: 'Strong day', tone: 'positive' })
  }

  if (suggestion.near_52w_high) {
    factors.push({ label: 'Near 52-week high · thin upside', tone: 'negative' })
  }

  const buyRatio =
    suggestion.analyst_total > 0 ? suggestion.analyst_buy / suggestion.analyst_total : 0
  if (buyRatio >= 0.65) {
    factors.push({
      label: 'Most analysts say buy',
      value: `${suggestion.analyst_buy} of ${suggestion.analyst_total} analysts`,
      tone: 'positive',
    })
  } else if (buyRatio >= 0.5) {
    factors.push({
      label: 'Majority say buy',
      value: `${suggestion.analyst_buy} of ${suggestion.analyst_total} analysts`,
      tone: 'positive',
    })
  }

  if (fundamentals.change_30d_pct != null && fundamentals.change_30d_pct >= 8) {
    factors.push({
      label: 'Up over 30 days',
      value: `+${fundamentals.change_30d_pct.toFixed(0)}%`,
      tone: 'positive',
    })
  }

  let target_label: Pick['target_label'] = 'analyst'
  let target_mean =
    fundamentals.target_mean ??
    fundamentals.target_price ??
    fundamentals.week52_high ??
    price
  let target_low = fundamentals.target_low
  let target_high = fundamentals.target_high

  if (!fundamentals.target_mean && !fundamentals.target_price && fundamentals.week52_high) {
    target_label = '52w_high'
    target_mean = fundamentals.week52_high
    target_low = null
    target_high = null
  }

  let upside_pct =
    suggestion.upside_pct ?? ((target_mean - price) / price) * 100

  if (upside_pct <= 0 && fundamentals.change_30d_pct != null && fundamentals.change_30d_pct > 5) {
    target_label = 'momentum'
    upside_pct = Math.min(fundamentals.change_30d_pct, 40)
    target_mean = price * (1 + upside_pct / 100)
    target_low = null
    target_high = null
  }

  const entry_low = Math.min(price * 0.97, price)
  const entry_high = price

  return {
    ticker: suggestion.ticker,
    company_name: suggestion.company_name,
    sector: suggestion.sector,
    current_price: price,
    change_1d_pct: suggestion.change_1d_pct,
    change_7d_pct: fundamentals.change_7d_pct,
    change_14d_pct: fundamentals.change_14d_pct,
    change_30d_pct: suggestion.change_30d_pct ?? fundamentals.change_30d_pct,
    volume_ratio: fundamentals.volume_ratio,
    news_count_7d: fundamentals.news_count_7d,
    entry_low,
    entry_high,
    target_mean,
    target_low,
    target_high,
    upside_pct,
    target_label,
    week52_high: fundamentals.week52_high,
    week52_low: fundamentals.week52_low,
    analyst_total: suggestion.analyst_total,
    analyst_buy: suggestion.analyst_buy,
    analyst_hold: suggestion.analyst_hold,
    analyst_sell: suggestion.analyst_sell,
    confidence: buyRatio >= 0.65 ? 'high' : buyRatio >= 0.5 ? 'medium' : 'low',
    score: suggestion.score,
    factors,
    vs_sector: null,
    source: 'discovery',
    ownership: null,
  }
}

async function resolveCompanyBlurb(
  pick: ScoredPick,
  fromMechanical: string | null | undefined,
): Promise<string> {
  if (fromMechanical?.trim()) return fromMechanical.trim()
  const yahoo = await fetchYahooBusinessSummary(pick.ticker)
  if (yahoo) return yahoo
  return mechanicalCompanyBlurb(pick.company_name, pick.ticker, pick.sector)
}

/** Immediate mechanical copy — same as Picks cards before Gemini finishes. */
export function mechanicalNarrativeSync(pick: ScoredPick): TrendingNarrative {
  return mechanicalThesis(pick)
}

export async function generateNarrativeForPick(
  pick: ScoredPick,
  fundamentals: StockFundamentals | undefined,
  headlines: string[],
): Promise<GeneratedNarrative> {
  const businessSummary = await fetchYahooBusinessSummary(pick.ticker)

  if (fundamentals) {
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
      change_7d_pct: fundamentals.change_7d_pct,
      change_30d_pct: fundamentals.change_30d_pct,
      week52_high: fundamentals.week52_high,
      week52_low: fundamentals.week52_low,
      news_sentiment: fundamentals.news_sentiment,
      factors: pick.factors.map((x) => x.label),
      recent_headlines: headlines,
      business_summary: businessSummary,
    })

    if (narrative) {
      return {
        company_blurb: narrative.company_blurb,
        thesis: narrative.thesis,
        main_risk: narrative.main_risk,
        narrative_source: 'llm',
        model: narrative.model,
      }
    }
  }

  const fallback = mechanicalThesis(pick)
  const company_blurb = await resolveCompanyBlurb(pick, fallback.company_blurb)
  return {
    company_blurb,
    thesis: fallback.thesis,
    main_risk: fallback.main_risk,
    narrative_source: 'mechanical',
    model: null,
  }
}

export async function generateNarrativeForTrending(
  suggestion: ScoredSuggestion,
  fundamentals: StockFundamentals | undefined,
  headlines: string[],
): Promise<GeneratedNarrative | null> {
  if (!fundamentals) return null
  const pick = trendingToScoredPick(suggestion, fundamentals)
  return generateNarrativeForPick(pick, fundamentals, headlines)
}

export async function persistPickNarrative(
  supabase: Supabase,
  ticker: string,
  narrative: GeneratedNarrative,
  logPrefix: string,
): Promise<void> {
  const { upsertNarratives, MECHANICAL_MODEL } = await import('@/lib/narrative-cache')
  await upsertNarratives(
    supabase,
    'pick_narratives',
    [
      {
        ticker: ticker.toUpperCase(),
        company_blurb: narrative.company_blurb,
        thesis: narrative.thesis,
        main_risk: narrative.main_risk,
        model:
          narrative.narrative_source === 'llm' && narrative.model
            ? narrative.model
            : MECHANICAL_MODEL,
        generated_at: new Date().toISOString(),
      },
    ],
    logPrefix,
  )
}
