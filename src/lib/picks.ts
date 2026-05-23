// Picks display copy + mechanical thesis.
// Scoring rules: @/lib/picks-scoring

import type { Pick } from '@/types'
import type { ScoredPick } from '@/lib/picks-scoring'
import {
  PICKS_DISCOVERY_MAX,
  PICKS_MAX_RESULTS,
  PICKS_MIN_ANALYSTS,
  PICKS_MIN_SCORE,
  PICKS_SCORING_RULES,
  rankDiscoveryPicks,
  rankPicks,
  scoreDiscoveryPick,
  scorePick,
} from '@/lib/picks-scoring'

export type { DiscoveryPickInput, PickCandidate, PickScoreInput, ScoredPick } from '@/lib/picks-scoring'
export {
  PICKS_DISCOVERY_MAX,
  PICKS_MAX_RESULTS,
  PICKS_MIN_ANALYSTS,
  PICKS_MIN_SCORE,
  PICKS_SCORING_RULES,
  rankDiscoveryPicks,
  rankPicks,
  scoreDiscoveryPick,
  scorePick,
}

/** Plain-language labels for the Picks UI. */
export function pickDisplayCopy(label: Pick['target_label']) {
  switch (label) {
    case 'analyst':
      return {
        targetHeading: 'Price target',
        targetSub: 'Average analyst estimate · ~1 year',
        upsideSub: 'to target',
        thesisTarget: (price: number) => `an average analyst target of $${price.toFixed(2)}`,
        defaultRisk:
          'Analyst targets are guesses about the next year — the stock can still go up or down.',
      }
    case '52w_high':
      return {
        targetHeading: 'Price target',
        targetSub: 'Based on 52-week high',
        upsideSub: 'to target',
        thesisTarget: (price: number) => `a target around $${price.toFixed(2)} (from the 52-week high)`,
        defaultRisk:
          'This target comes from the past year’s high — not a bank forecast — and the stock may not reach it.',
      }
    case 'momentum':
      return {
        targetHeading: 'Price target',
        targetSub: 'Estimate from recent trend',
        upsideSub: 'to target',
        thesisTarget: (_price: number, upsidePct: number) =>
          `recent price strength and buy ratings pointing to about ${upsidePct.toFixed(0)}% upside`,
        defaultRisk:
          'This target is estimated from recent price action — not an official analyst forecast.',
      }
  }
}

export function mechanicalThesis(pick: ScoredPick): { thesis: string; main_risk: string } {
  const positives = pick.factors.filter((f) => f.tone === 'positive').map((f) => f.label.toLowerCase())
  const negatives = pick.factors.filter((f) => f.tone === 'negative').map((f) => f.label.toLowerCase())

  const defaultHead =
    pick.source === 'discovery'
      ? `Strong momentum in ${pick.sector ?? 'the market'} today.`
      : pick.source === 'portfolio' || pick.source === 'both'
        ? 'Several signals look positive for this holding.'
        : 'Several signals look positive for this watchlist stock.'

  const head = positives.length
    ? `${positives[0].charAt(0).toUpperCase() + positives[0].slice(1)}.`
    : defaultHead

  const copy = pickDisplayCopy(pick.target_label)
  const targetNote = copy.thesisTarget(pick.target_mean, pick.upside_pct)

  const thesis = `${head} ${pick.analyst_buy} of ${pick.analyst_total} analysts rate buy, with ${targetNote}.`

  const risk = negatives.length
    ? `Watch for ${negatives.join(', ')} in the weeks ahead.`
    : copy.defaultRisk

  return { thesis, main_risk: risk }
}
