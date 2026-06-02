/**
 * Global Top Picks scoring v2 — stricter gates, analyst targets only, variable result count.
 * DB-only inputs (no live Yahoo). Used by nightly build-global-picks cron.
 */

import {
  applyVsSectorScore,
  buildPickVsSector,
  type PickScoreInput,
  type ScoredPick,
} from '@/lib/picks-scoring'
import {
  applyResearchScore,
  computeSectorPeMedians,
  isEarningsExclusionWindow,
  sectorPeMedianForTicker,
  type ResearchScoringContext,
} from '@/lib/picks-research-scoring'
import { isAnalystTargetSource } from '@/lib/target-price-display'
import type { Pick, PickFactor, StockFundamentals, StockResearchSnapshot } from '@/types'

export const PICKS_V2_MIN_SCORE = 35
export const PICKS_V2_MAX_RESULTS = 15
export const PICKS_V2_MIN_PUBLISH_COUNT = 3
export const PICKS_V2_MIN_ANALYSTS = 8
export const PICKS_V2_MIN_UPSIDE_PCT = 8
export const PICKS_V2_MIN_MARKET_CAP = 500_000_000
export const PICKS_V2_MIN_PRICE = 5
export const PICKS_V2_EARNINGS_EXCLUDE_DAYS = 7

export const PICKS_V2_RULES = {
  gates: {
    maxSellRatio: 0.35,
    minBuyRatio: 0.5,
    minNewsSentiment: 0,
    min30dPct: 0,
  },
  upsideAnalyst: {
    tiers: [
      { minPct: 30, points: 44 },
      { minPct: 15, points: 31 },
      { minPct: 8, points: 13 },
    ],
  },
  buyConsensus: {
    strongRatio: 0.7,
    strongPoints: 25,
    moderateRatio: 0.5,
    moderatePoints: 15,
    leanRatio: 0.5,
    leanPoints: 8,
  },
  pullback14d: { minPct: -15, maxPct: -3, minUpsidePct: 8, points: 12 },
  newsSentiment: { minPct: 0.3, points: 10 },
  newsBuzz: { minCount: 8, points: 5 },
  nearSupport20d: { proximityRatio: 1.03, points: 8 },
  near52wHigh: { proximityRatio: 0.97, thinUpsideMaxPct: 5, penaltyPoints: 15 },
  volumeSpike: { minRatio: 1.5, points: 8, strongRatio: 2.0, strongPoints: 12 },
  liquidityBand: { minRatio: 1.2, maxRatio: 2.0, points: 4 },
  weekMomentum: { minPct: 5, points: 6 },
  aboveAvg20d: { points: 5 },
  confidence: {
    highMinAnalysts: 15,
    highMinBuyRatio: 0.6,
    mediumMinAnalysts: 6,
    mediumMinBuyRatio: 0.5,
  },
  dayMoveCap: { minPct: 2.5, maxPoints: 12 },
} as const

function passesResearchQualityGate(research: StockResearchSnapshot | null): boolean {
  if (!research) return false
  const profitable = (research.profit_margin_pct ?? Number.NEGATIVE_INFINITY) > 0
  const growing = (research.revenue_growth_pct ?? Number.NEGATIVE_INFINITY) > 0
  return profitable || growing
}

function resolveAnalystTarget(
  f: StockFundamentals,
  current_price: number,
): {
  target_mean: number
  target_low: number | null
  target_high: number | null
  upside_pct: number
} | null {
  if (f.target_price && f.target_price > 0 && isAnalystTargetSource(f.target_source)) {
    const upside_pct = ((f.target_price - current_price) / current_price) * 100
    if (upside_pct < PICKS_V2_MIN_UPSIDE_PCT) return null
    return {
      target_mean: f.target_price,
      target_low: f.target_low,
      target_high: f.target_high,
      upside_pct,
    }
  }

  if (f.target_mean && f.target_mean > 0 && (!f.target_source || isAnalystTargetSource(f.target_source))) {
    const upside_pct = ((f.target_mean - current_price) / current_price) * 100
    if (upside_pct < PICKS_V2_MIN_UPSIDE_PCT) return null
    return {
      target_mean: f.target_mean,
      target_low: f.target_low,
      target_high: f.target_high,
      upside_pct,
    }
  }

  return null
}

function applyResearchScoreV2(
  ctx: ResearchScoringContext,
  sector: string | null,
  factors: PickFactor[],
): number {
  let delta = applyResearchScore(ctx, sector, factors)
  const r = ctx.research
  const pe = r?.pe_trailing
  const median = ctx.sectorPeMedian
  if (pe != null && pe > 0 && median != null && median > 0) {
    const ratio = pe / median
    if (ratio >= 1.5 && ratio < 2.0) {
      const extra = -2
      delta += extra
      if (!factors.some((f) => f.label === 'Rich vs sector P/E')) {
        factors.push({
          label: 'Rich vs sector P/E (v2)',
          value: `${ratio.toFixed(1)}× sector median`,
          tone: 'negative',
        })
      }
    }
  }
  return Math.max(-20, Math.min(20, delta))
}

function applySignalBonusesV2(
  f: StockFundamentals,
  current_price: number,
  factors: PickFactor[],
): number {
  const rules = PICKS_V2_RULES
  let bonus = 0

  if (f.volume_ratio != null) {
    if (f.volume_ratio >= rules.volumeSpike.strongRatio) {
      bonus += rules.volumeSpike.strongPoints
      factors.push({
        label: 'Unusually high volume',
        value: `${f.volume_ratio.toFixed(1)}× avg`,
        tone: 'positive',
      })
    } else if (f.volume_ratio >= rules.volumeSpike.minRatio) {
      bonus += rules.volumeSpike.points
      factors.push({
        label: 'Higher than usual volume',
        value: `${f.volume_ratio.toFixed(1)}× avg`,
        tone: 'positive',
      })
    } else if (
      f.volume_ratio >= rules.liquidityBand.minRatio &&
      f.volume_ratio <= rules.liquidityBand.maxRatio
    ) {
      bonus += rules.liquidityBand.points
      factors.push({
        label: 'Healthy trading interest',
        value: `${f.volume_ratio.toFixed(1)}× avg`,
        tone: 'positive',
      })
    }
  }

  if (f.change_7d_pct != null && f.change_7d_pct >= rules.weekMomentum.minPct) {
    bonus += rules.weekMomentum.points
    factors.push({
      label: 'Up over 7 days',
      value: `+${f.change_7d_pct.toFixed(1)}%`,
      tone: 'positive',
    })
  }

  if (f.avg_20d && current_price >= f.avg_20d) {
    bonus += rules.aboveAvg20d.points
    factors.push({ label: 'Above recent average price', tone: 'positive' })
  }

  if (f.news_count_7d != null && f.news_count_7d >= rules.newsBuzz.minCount) {
    bonus += rules.newsBuzz.points
    factors.push({
      label: 'In the news lately',
      value: `${f.news_count_7d} articles/wk`,
      tone: 'neutral',
    })
  }

  return bonus
}

function applyDayMoveCap(
  pick: ScoredPick,
  change_1d_pct: number | null,
): ScoredPick {
  const rules = PICKS_V2_RULES.dayMoveCap
  if (change_1d_pct == null || change_1d_pct < rules.minPct) return pick

  const tiers = [
    { min: 8, points: 12 },
    { min: 5, points: 10 },
    { min: 2.5, points: 8 },
  ]
  const tier = tiers.find((t) => change_1d_pct >= t.min)
  if (!tier) return pick

  const points = Math.min(tier.points, rules.maxPoints)
  return {
    ...pick,
    score: pick.score + points,
    factors: [
      {
        label: 'Big move today',
        value: `${change_1d_pct >= 0 ? '+' : ''}${change_1d_pct.toFixed(1)}% today`,
        tone: 'positive',
      },
      ...pick.factors.filter((x) => x.label !== 'Big move today'),
    ],
  }
}

export function scorePickV2(input: PickScoreInput): ScoredPick | null {
  const {
    candidate,
    current_price,
    change_1d_pct,
    fundamentals: f,
    ownership,
    benchmark,
    researchContext = { research: null, sectorPeMedian: null },
  } = input
  const research = researchContext.research
  const rules = PICKS_V2_RULES
  const factors: PickFactor[] = []
  let score = 0

  if (current_price < PICKS_V2_MIN_PRICE) return null
  if (isEarningsExclusionWindow(research, PICKS_V2_EARNINGS_EXCLUDE_DAYS)) return null
  if (!passesResearchQualityGate(research)) return null

  const marketCap = research?.market_cap
  if (marketCap == null || marketCap < PICKS_V2_MIN_MARKET_CAP) return null

  const analyst_total = (f.analyst_buy ?? 0) + (f.analyst_hold ?? 0) + (f.analyst_sell ?? 0)
  if (analyst_total < PICKS_V2_MIN_ANALYSTS) return null

  const sell_ratio = (f.analyst_sell ?? 0) / analyst_total
  if (sell_ratio > rules.gates.maxSellRatio) return null

  const buy_ratio = (f.analyst_buy ?? 0) / analyst_total
  if (buy_ratio < rules.gates.minBuyRatio) return null

  if (f.news_sentiment != null && f.news_sentiment < rules.gates.minNewsSentiment) return null

  if (f.change_30d_pct != null && f.change_30d_pct < rules.gates.min30dPct) return null

  const target = resolveAnalystTarget(f, current_price)
  if (!target) return null

  const upside_pct = target.upside_pct
  const tier = rules.upsideAnalyst.tiers.find((t) => upside_pct >= t.minPct)
  if (tier) {
    score += tier.points
    factors.push({ label: `+${upside_pct.toFixed(0)}% room to target`, tone: 'positive' })
  }

  if (buy_ratio > rules.buyConsensus.strongRatio) {
    score += rules.buyConsensus.strongPoints
    factors.push({
      label: 'Most analysts say buy',
      value: `${f.analyst_buy} of ${analyst_total} analysts`,
      tone: 'positive',
    })
  } else if (buy_ratio > rules.buyConsensus.moderateRatio) {
    score += rules.buyConsensus.moderatePoints
    factors.push({
      label: 'Majority say buy',
      value: `${f.analyst_buy} of ${analyst_total} analysts`,
      tone: 'positive',
    })
  } else if (buy_ratio >= rules.buyConsensus.leanRatio) {
    score += rules.buyConsensus.leanPoints
    factors.push({
      label: 'Leaning buy',
      value: `${f.analyst_buy} of ${analyst_total} analysts`,
      tone: 'positive',
    })
  }

  const pb = PICKS_V2_RULES.pullback14d
  if (
    f.change_14d_pct != null &&
    f.change_14d_pct < pb.maxPct &&
    f.change_14d_pct > pb.minPct &&
    upside_pct > pb.minUpsidePct
  ) {
    score += pb.points
    factors.push({
      label: 'Pulled back recently',
      value: `${f.change_14d_pct.toFixed(1)}% in 14d`,
      tone: 'positive',
    })
  }

  if (f.news_sentiment != null && f.news_sentiment > rules.newsSentiment.minPct) {
    score += rules.newsSentiment.points
    factors.push({ label: 'Good news tone', tone: 'positive' })
  }

  if (f.support_20d && current_price <= f.support_20d * rules.nearSupport20d.proximityRatio) {
    score += rules.nearSupport20d.points
    factors.push({ label: 'Near support level', tone: 'positive' })
  }

  const near52w =
    f.week52_high != null && current_price >= f.week52_high * rules.near52wHigh.proximityRatio
  if (near52w && upside_pct < rules.near52wHigh.thinUpsideMaxPct) {
    score -= rules.near52wHigh.penaltyPoints
    factors.push({ label: 'Near 52-week high · thin upside', tone: 'negative' })
  }

  score += applySignalBonusesV2(f, current_price, factors)

  const vs_sector = buildPickVsSector(candidate, f, benchmark)
  score += applyVsSectorScore(vs_sector, candidate.sector, factors)
  score += applyResearchScoreV2(researchContext, candidate.sector, factors)

  if (score < PICKS_V2_MIN_SCORE) return null

  const support = f.support_20d ?? current_price * 0.97
  const entry_low = Math.max(support * 1.005, current_price * 0.97)
  const entry_high = current_price

  let confidence: Pick['confidence'] = 'low'
  if (
    analyst_total >= rules.confidence.highMinAnalysts &&
    buy_ratio > rules.confidence.highMinBuyRatio
  ) {
    confidence = 'high'
  } else if (
    analyst_total >= rules.confidence.mediumMinAnalysts &&
    buy_ratio > rules.confidence.mediumMinBuyRatio
  ) {
    confidence = 'medium'
  }

  if (
    research &&
    (research.profit_margin_pct ?? 0) < 0 &&
    research.pe_trailing == null
  ) {
    if (confidence === 'high') confidence = 'medium'
    else if (confidence === 'medium') confidence = 'low'
  }

  if (confidence !== 'high') return null

  const base: ScoredPick = {
    ticker: candidate.ticker,
    company_name: candidate.company_name,
    sector: candidate.sector,
    current_price,
    change_1d_pct,
    change_1d_session: input.change_1d_session,
    change_7d_pct: f.change_7d_pct,
    change_14d_pct: f.change_14d_pct,
    change_30d_pct: f.change_30d_pct,
    volume_ratio: f.volume_ratio,
    news_count_7d: f.news_count_7d,
    entry_low: Math.min(entry_low, entry_high),
    entry_high,
    target_mean: target.target_mean,
    target_low: target.target_low,
    target_high: target.target_high,
    upside_pct,
    target_label: 'analyst',
    week52_high: f.week52_high,
    week52_low: f.week52_low,
    analyst_total,
    analyst_buy: f.analyst_buy ?? 0,
    analyst_hold: f.analyst_hold ?? 0,
    analyst_sell: f.analyst_sell ?? 0,
    confidence,
    score,
    factors,
    vs_sector,
    source: 'discovery',
    ownership,
  }

  return applyDayMoveCap(base, change_1d_pct)
}

/** Return all qualifiers up to cap — ranked by score (points) only. */
export function rankGlobalPicks(scored: ScoredPick[], limit = PICKS_V2_MAX_RESULTS): ScoredPick[] {
  return [...scored]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.upside_pct !== a.upside_pct) return b.upside_pct - a.upside_pct
      return (b.change_1d_pct ?? 0) - (a.change_1d_pct ?? 0)
    })
    .slice(0, limit)
}

export { computeSectorPeMedians, sectorPeMedianForTicker }
