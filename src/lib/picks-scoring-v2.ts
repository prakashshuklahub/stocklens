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
  daysUntilCalendarDate,
  isEarningsExclusionWindow,
  sectorPeMedianForTicker,
  type ResearchScoringContext,
} from '@/lib/picks-research-scoring'
import { normalizeWatchlistSector } from '@/lib/sector-relative-strength-scoring'
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
export const PICKS_V2_EARNINGS_SOFT_PENALTY_DAYS = 14
export const PICKS_V2_EARNINGS_SOFT_PENALTY_POINTS = 10
export const PICKS_V2_SECTOR_CAP = 3
export const PICKS_V2_LIVE_MOMENTUM_RULES = {
  sweetSpotMinPct: 10,
  sweetSpotMaxPct: 30,
  sweetSpotPoints: 8,
  moderateMaxPct: 60,
  moderatePoints: 4,
  overheatedMinPct: 60,
  overheatedPenalty: 10,
} as const
export const PICKS_V2_UPSIDE_TO_RAN_RATIO_MIN = 0.2
export const PICKS_V2_UPSIDE_TO_RAN_RATIO_PENALTY = 12
export const PICKS_V2_DISPERSION_RULES = {
  wildMin: 1.0,
  wildPenalty: 6,
  extremeMin: 1.5,
  extremePenalty: 12,
} as const

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
  near52wHigh: { proximityRatio: 0.97, thinUpsideMaxPct: 10, penaltyPoints: 15 },
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

function applyEarningsSoftPenalty(research: StockResearchSnapshot | null, factors: PickFactor[]): number {
  const days = daysUntilCalendarDate(research?.earnings_date)
  if (days == null) return 0
  if (days < 0) return 0
  if (days <= PICKS_V2_EARNINGS_EXCLUDE_DAYS) return 0
  if (days > PICKS_V2_EARNINGS_SOFT_PENALTY_DAYS) return 0
  factors.push({
    label: 'Earnings soon',
    value: `${days}d`,
    tone: 'negative',
  })
  return -PICKS_V2_EARNINGS_SOFT_PENALTY_POINTS
}

function apply30dMomentumScore(change_30d_pct: number | null | undefined, factors: PickFactor[]): number {
  const c30 = change_30d_pct
  if (c30 == null || !Number.isFinite(c30)) return 0
  const rules = PICKS_V2_LIVE_MOMENTUM_RULES
  if (c30 >= rules.sweetSpotMinPct && c30 <= rules.sweetSpotMaxPct) {
    factors.push({ label: 'Healthy 30d momentum', value: `+${c30.toFixed(0)}%`, tone: 'positive' })
    return rules.sweetSpotPoints
  }
  if (c30 > rules.sweetSpotMaxPct && c30 <= rules.moderateMaxPct) {
    factors.push({ label: 'Strong 30d momentum', value: `+${c30.toFixed(0)}%`, tone: 'neutral' })
    return rules.moderatePoints
  }
  if (c30 > rules.overheatedMinPct) {
    factors.push({ label: 'Overheated 30d run', value: `+${c30.toFixed(0)}%`, tone: 'negative' })
    return -rules.overheatedPenalty
  }
  return 0
}

function applyUpsideToRanPenalty(
  upside_pct: number,
  change_30d_pct: number | null | undefined,
  factors: PickFactor[],
): number {
  const c30 = change_30d_pct
  if (c30 == null || !Number.isFinite(c30) || c30 <= 0) return 0
  if (!Number.isFinite(upside_pct) || upside_pct <= 0) return 0
  const ratio = upside_pct / c30
  if (ratio >= PICKS_V2_UPSIDE_TO_RAN_RATIO_MIN) return 0
  factors.push({
    label: 'Limited upside vs recent run',
    value: `${ratio.toFixed(2)}×`,
    tone: 'negative',
  })
  return -PICKS_V2_UPSIDE_TO_RAN_RATIO_PENALTY
}

function applyTargetDispersionPenalty(
  target_mean: number,
  target_low: number | null,
  target_high: number | null,
  factors: PickFactor[],
): number {
  if (!(target_mean > 0)) return 0
  if (target_low == null || target_high == null) return 0
  if (!(target_high > target_low)) return 0
  const dispersion = (target_high - target_low) / target_mean
  const rules = PICKS_V2_DISPERSION_RULES
  if (dispersion >= rules.extremeMin) {
    factors.push({ label: 'Analysts disagree widely', value: `${dispersion.toFixed(1)}×`, tone: 'negative' })
    return -rules.extremePenalty
  }
  if (dispersion >= rules.wildMin) {
    factors.push({ label: 'Analyst dispersion', value: `${dispersion.toFixed(1)}×`, tone: 'negative' })
    return -rules.wildPenalty
  }
  return 0
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

  // Penalize extremely high P/E when margins don't support it.
  const margin = r?.profit_margin_pct
  if (pe != null && pe > 0 && margin != null && Number.isFinite(margin)) {
    if (pe > 100 && margin < 20) {
      delta -= 20
      factors.push({ label: 'High P/E · thin margin', value: `${pe.toFixed(0)} P/E · ${margin.toFixed(0)}%`, tone: 'negative' })
    } else if (pe > 50 && margin < 10) {
      delta -= 15
      factors.push({ label: 'Stretched P/E · low margin', value: `${pe.toFixed(0)} P/E · ${margin.toFixed(0)}%`, tone: 'negative' })
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
    if (f.volume_ratio >= 3) {
      factors.push({
        label: 'Overheated volume',
        value: `${f.volume_ratio.toFixed(1)}× avg`,
        tone: 'neutral',
      })
    } else if (f.volume_ratio >= rules.volumeSpike.strongRatio) {
      bonus += Math.max(1, Math.round(rules.volumeSpike.strongPoints / 2))
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

  score += applyEarningsSoftPenalty(research, factors)
  score += applyTargetDispersionPenalty(target.target_mean, target.target_low, target.target_high, factors)
  score += apply30dMomentumScore(f.change_30d_pct, factors)
  score += applyUpsideToRanPenalty(upside_pct, f.change_30d_pct, factors)

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
  const sorted = [...scored].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.upside_pct !== a.upside_pct) return b.upside_pct - a.upside_pct
    return (b.change_1d_pct ?? 0) - (a.change_1d_pct ?? 0)
  })

  const picked: ScoredPick[] = []
  const sectorCounts = new Map<string, number>()
  for (const p of sorted) {
    if (picked.length >= limit) break
    const sector = normalizeWatchlistSector(p.sector)
    if (sector && sector !== 'Other') {
      const next = (sectorCounts.get(sector) ?? 0) + 1
      if (next > PICKS_V2_SECTOR_CAP) continue
      sectorCounts.set(sector, next)
    }
    picked.push(p)
  }

  return picked
}

export { computeSectorPeMedians, sectorPeMedianForTicker }
