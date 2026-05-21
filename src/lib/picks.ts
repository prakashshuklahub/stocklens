// Buy-recommendation scoring. Pure functions — no IO.
// Consumed by /api/picks.
//
// Note: Finnhub price-target is a paid endpoint; target_mean is often null on free tier.
// We fall back to 52W-high room or momentum when analyst targets are missing.

import type {
  Pick,
  PickFactor,
  PickOwnership,
  StockFundamentals,
  WatchlistStock,
} from '@/types'

export interface ScoreInput {
  stock: WatchlistStock
  current_price: number
  fundamentals: StockFundamentals
  ownership: PickOwnership | null
}

export type ScoredPick = Omit<Pick, 'thesis' | 'main_risk' | 'narrative_source'>

const MIN_ANALYSTS = 3
const MIN_SCORE = 10

type TargetLabel = Pick['target_label']

/** Plain-language labels for the Picks UI (no vendor jargon). */
export function pickDisplayCopy(label: TargetLabel) {
  switch (label) {
    case 'analyst':
      return {
        targetSub: 'Wall Street average',
        thesisTarget: (price: number) => `the average 12-month analyst target of $${price.toFixed(2)}`,
        defaultRisk:
          'Analyst targets look about a year ahead; the stock can still move up or down in the meantime.',
      }
    case '52w_high':
      return {
        targetSub: '52-week high',
        thesisTarget: (price: number) =>
          `room to move back toward its 52-week high of $${price.toFixed(2)}`,
        defaultRisk:
          'The target is this year’s highest price so far—not a guarantee the stock will reach it.',
      }
    case 'momentum':
      return {
        targetSub: 'Trend estimate',
        thesisTarget: (_price: number, upsidePct: number) =>
          `recent momentum and strong buy ratings suggesting about ${upsidePct.toFixed(0)}% upside`,
        defaultRisk:
          'The target is an estimate from recent price action and analyst ratings—not an official bank forecast.',
      }
  }
}

function resolveTarget(
  f: StockFundamentals,
  current_price: number,
  buy_ratio: number,
): { target_mean: number; target_low: number | null; target_high: number | null; upside_pct: number; label: TargetLabel; factor?: PickFactor } | null {
  if (f.target_mean && f.target_mean > 0) {
    const upside_pct = ((f.target_mean - current_price) / current_price) * 100
    return {
      target_mean: f.target_mean,
      target_low: f.target_low,
      target_high: f.target_high,
      upside_pct,
      label: 'analyst',
    }
  }

  // Free-tier fallback: room to 52-week high
  if (f.week52_high && current_price < f.week52_high * 0.97) {
    const upside_pct = ((f.week52_high - current_price) / current_price) * 100
    if (upside_pct >= 3) {
      return {
        target_mean: f.week52_high,
        target_low: f.week52_low,
        target_high: f.week52_high,
        upside_pct,
        label: '52w_high',
        factor: { label: 'Upside to 52W high', tone: 'positive' },
      }
    }
  }

  // Momentum + buy consensus when no price target data
  if (buy_ratio >= 0.45 && (f.change_30d_pct ?? 0) > 5) {
    const upside_pct = Math.min(f.change_30d_pct ?? 12, 40)
    return {
      target_mean: current_price * (1 + upside_pct / 100),
      target_low: null,
      target_high: null,
      upside_pct,
      label: 'momentum',
      factor: { label: 'Momentum + buy consensus', tone: 'positive' },
    }
  }

  return null
}

export function scorePick(input: ScoreInput): ScoredPick | null {
  const { stock, current_price, fundamentals: f, ownership } = input
  const factors: PickFactor[] = []
  let score = 0

  if (current_price <= 0) return null

  const analyst_total = (f.analyst_buy ?? 0) + (f.analyst_hold ?? 0) + (f.analyst_sell ?? 0)
  if (analyst_total < MIN_ANALYSTS) return null

  const sell_ratio = (f.analyst_sell ?? 0) / analyst_total
  if (sell_ratio > 0.5) return null

  if (f.news_sentiment != null && f.news_sentiment < -0.5) return null

  const buy_ratio = (f.analyst_buy ?? 0) / analyst_total
  const target = resolveTarget(f, current_price, buy_ratio)
  if (!target) return null

  if (target.factor) factors.push(target.factor)
  const upside_pct = target.upside_pct

  if (upside_pct <= 0) return null

  // ── Scoring factors ────────────────────────────────────────────────────────
  if (target.label === 'analyst') {
    if (upside_pct > 30) {
      score += 35
      factors.push({ label: `+${upside_pct.toFixed(0)}% to analyst target`, tone: 'positive' })
    } else if (upside_pct > 15) {
      score += 25
      factors.push({ label: `+${upside_pct.toFixed(0)}% to analyst target`, tone: 'positive' })
    } else if (upside_pct > 5) {
      score += 10
      factors.push({ label: `+${upside_pct.toFixed(0)}% to analyst target`, tone: 'positive' })
    }
  } else if (upside_pct >= 10) {
    score += 20
  } else {
    score += 10
  }

  if (buy_ratio > 0.7) {
    score += 20
    factors.push({
      label: 'Strong buy consensus',
      value: `${f.analyst_buy} of ${analyst_total} analysts`,
      tone: 'positive',
    })
  } else if (buy_ratio > 0.5) {
    score += 12
    factors.push({
      label: 'Majority buy rating',
      value: `${f.analyst_buy} of ${analyst_total} analysts`,
      tone: 'positive',
    })
  } else if (buy_ratio >= 0.45) {
    score += 6
    factors.push({
      label: 'Buy-leaning consensus',
      value: `${f.analyst_buy} of ${analyst_total} analysts`,
      tone: 'positive',
    })
  }

  if (f.change_14d_pct != null && f.change_14d_pct < -3 && f.change_14d_pct > -15 && upside_pct > 8) {
    score += 12
    factors.push({
      label: 'Recent pullback',
      value: `${f.change_14d_pct.toFixed(1)}% in 14d`,
      tone: 'positive',
    })
  }

  if (f.news_sentiment != null && f.news_sentiment > 0.3) {
    score += 10
    factors.push({ label: 'Positive news sentiment', tone: 'positive' })
  }

  if (f.support_20d && current_price <= f.support_20d * 1.03) {
    score += 8
    factors.push({ label: 'Near recent support', tone: 'positive' })
  }

  if (f.week52_high && current_price >= f.week52_high * 0.97) {
    score -= 15
    factors.push({ label: 'Near 52W high', tone: 'negative' })
  }

  if (ownership) score -= 5

  if (score < MIN_SCORE) return null

  const support = f.support_20d ?? current_price * 0.97
  const entry_low = Math.max(support * 1.005, current_price * 0.97)
  const entry_high = current_price

  let confidence: 'high' | 'medium' | 'low' = 'low'
  if (analyst_total >= 15 && buy_ratio > 0.6) confidence = 'high'
  else if (analyst_total >= 6 && buy_ratio > 0.5) confidence = 'medium'

  return {
    ticker: stock.ticker,
    company_name: stock.company_name,
    sector: stock.sector,
    current_price,
    entry_low: Math.min(entry_low, entry_high),
    entry_high,
    target_mean: target.target_mean,
    target_low: target.target_low,
    target_high: target.target_high,
    upside_pct,
    target_label: target.label,
    analyst_total,
    analyst_buy: f.analyst_buy ?? 0,
    analyst_hold: f.analyst_hold ?? 0,
    analyst_sell: f.analyst_sell ?? 0,
    confidence,
    score,
    factors,
    ownership,
  }
}

const CONFIDENCE_RANK: Record<Pick['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

export function rankPicks(scored: ScoredPick[], limit = 10): ScoredPick[] {
  return [...scored]
    .sort((a, b) => {
      const byConfidence = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
      if (byConfidence !== 0) return byConfidence
      return b.score - a.score
    })
    .slice(0, limit)
}

export function mechanicalThesis(pick: ScoredPick): { thesis: string; main_risk: string } {
  const positives = pick.factors.filter((f) => f.tone === 'positive').map((f) => f.label.toLowerCase())
  const negatives = pick.factors.filter((f) => f.tone === 'negative').map((f) => f.label.toLowerCase())

  const head = positives.length
    ? `${positives[0].charAt(0).toUpperCase() + positives[0].slice(1)}.`
    : 'Favorable signals on your watchlist.'

  const copy = pickDisplayCopy(pick.target_label)
  const targetNote = copy.thesisTarget(pick.target_mean, pick.upside_pct)

  const thesis = `${head} ${pick.analyst_buy} of ${pick.analyst_total} analysts rate buy, with ${targetNote}.`

  const risk = negatives.length
    ? `Watch for ${negatives.join(', ')} in the weeks ahead.`
    : copy.defaultRisk

  return { thesis, main_risk: risk }
}
