/**
 * Picks scoring — edit this file to change how buy ideas are ranked.
 *
 * All candidates (watchlist, portfolio, strong movers) use the same scoreUnifiedPick().
 * Source tags are metadata only — they do not change the score formula.
 * Strong movers must pass discovery pool gates before scoring; then rank via rankAllPicks().
 */

import type { MarketSession } from '@/lib/market-hours'
import {
  allowMomentumTarget,
  applyResearchScore,
  isEarningsExclusionWindow,
  passesDiscoveryResearchQualityGate,
  type ResearchScoringContext,
} from '@/lib/picks-research-scoring'
import { isBenchmarkableSector, PICKS_VS_SECTOR_RULES } from '@/lib/sector-relative-strength-scoring'
import { computeVsSector } from '@/lib/sector-relative-strength'
import type { MoverQuote } from '@/lib/market-movers'
import { isAnalystTargetSource } from '@/lib/target-price-display'
import type {
  Pick,
  PickFactor,
  PickOwnership,
  PickSourceTag,
  SectorBenchmark,
  SectorRelativeStrength,
  StockFundamentals,
  StockResearchSnapshot,
} from '@/types'

// ── Tunable constants ─────────────────────────────────────────────────────────

export const PICKS_MIN_ANALYSTS = 3
export const PICKS_MIN_SCORE = 20
/** Top picks returned across watchlist, portfolio, and strong movers combined. */
export const PICKS_MAX_RESULTS = 10
/** @deprecated Pre-rank cap removed — all discovery qualifiers compete in rankAllPicks(). */
export const PICKS_DISCOVERY_MAX = 10
export const PICKS_DISCOVERY_MIN_SCORE = 18
/** Cap upside-tier points when target is momentum-derived (avoids circular inflation). */
export const PICKS_MOMENTUM_TARGET_MAX_UPSIDE_POINTS = 20

export const PICKS_SCORING_RULES = {
  gates: {
    maxSellRatio: 0.5,
    minNewsSentiment: -0.5,
    momentumMinBuyRatio: 0.45,
    momentumMin30dPct: 5,
    /** Synthetic momentum target capped at 20% upside (was 40%). */
    momentumMaxUpsidePct: 20,
  },
  upsideAnalyst: {
    tiers: [
      { minPct: 30, points: 35 },
      { minPct: 15, points: 25 },
      { minPct: 5, points: 10 },
    ],
    momentumFallbackPoints: 20,
    momentumLowPoints: 10,
    momentumMinPct: 10,
  },
  buyConsensus: {
    strongRatio: 0.7,
    strongPoints: 20,
    moderateRatio: 0.5,
    moderatePoints: 12,
    leanRatio: 0.45,
    leanPoints: 6,
  },
  pullback14d: { minPct: -15, maxPct: -3, minUpsidePct: 8, points: 12 },
  newsSentiment: { minPct: 0.3, points: 10 },
  newsBuzz: { minCount: 8, points: 5 },
  nearSupport20d: { proximityRatio: 1.03, points: 8 },
  near52wHigh: { proximityRatio: 0.97, thinUpsideMaxPct: 5, penaltyPoints: 15 },
  volumeSpike: { minRatio: 1.5, points: 8, strongRatio: 2.0, strongPoints: 12 },
  weekMomentum: { minPct: 5, points: 6 },
  aboveAvg20d: { points: 5 },
  confidence: {
    highMinAnalysts: 15,
    highMinBuyRatio: 0.6,
    mediumMinAnalysts: 6,
    mediumMinBuyRatio: 0.5,
  },
} as const

export const PICKS_DISCOVERY_RULES = {
  minAnalysts: 5,
  minBuyRatio: 0.4,
  minDayMovePct: 2.5,
  dayMoveTiers: [
    { min: 8, points: 22 },
    { min: 5, points: 16 },
    { min: 2.5, points: 10 },
  ],
  monthTrend: { strongMin: 12, strongPoints: 12, moderateMin: 6, moderatePoints: 6 },
} as const

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PickCandidate {
  ticker: string
  company_name: string
  sector: string | null
  source: PickSourceTag
}

export interface PickScoreInput {
  candidate: PickCandidate
  current_price: number
  change_1d_pct: number | null
  change_1d_session?: MarketSession
  fundamentals: StockFundamentals
  ownership: PickOwnership | null
  benchmark?: SectorBenchmark | null
  researchContext?: ResearchScoringContext
}

export interface DiscoveryPickInput {
  mover: MoverQuote
  current_price: number
  change_1d_pct: number
  change_1d_session?: MarketSession
  fundamentals: StockFundamentals | null
  benchmark?: SectorBenchmark | null
  researchContext?: ResearchScoringContext
}

export type ScoredPick = Omit<
  Pick,
  'thesis' | 'main_risk' | 'narrative_source' | 'narrative_generated_at' | 'news' | 'company_blurb'
>

type TargetLabel = Pick['target_label']

interface BuildPickOptions {
  minScore: number
  momentumUpsidePointsCap: number | null
}

export function buildPickVsSector(
  candidate: PickCandidate,
  f: StockFundamentals,
  benchmark: SectorBenchmark | null | undefined,
): SectorRelativeStrength | null {
  if (!benchmark) return null
  const vs = computeVsSector({
    ticker: candidate.ticker,
    sector: candidate.sector,
    sectorSource: candidate.source === 'discovery' ? 'resolved' : 'watchlist',
    fundamentals: f,
    benchmark,
  })
  if (!vs.benchmark_ticker) return null
  return vs
}

export function applyVsSectorScore(
  vs: SectorRelativeStrength | null,
  sector: string | null,
  factors: PickFactor[],
): number {
  if (!vs || !isBenchmarkableSector(sector)) return 0
  const rules = PICKS_VS_SECTOR_RULES
  const windowDelta = vs.windows?.d7?.delta ?? vs.windows?.d30?.delta ?? null

  const rsPart =
    vs.rs_score != null && vs.rs_score >= rules.strongRsMin
      ? rules.strongRsPoints
      : vs.rs_score != null && vs.rs_score <= rules.weakRsMax
        ? -rules.weakRsPenalty
        : 0

  const deltaPart =
    windowDelta != null && windowDelta >= rules.beatMinDelta
      ? rules.beatPoints
      : windowDelta != null && windowDelta <= rules.lagMaxDelta
        ? -rules.lagPenalty
        : 0

  const sectorBonus = Math.max(rsPart, deltaPart)

  if (sectorBonus > 0) {
    if (vs.badge === 'leader' && windowDelta != null && windowDelta >= rules.beatMinDelta) {
      factors.push({
        label: `Leading its sector vs ${vs.benchmark_ticker}`,
        value: `+${windowDelta.toFixed(1)}%`,
        tone: 'positive',
      })
    } else if (vs.rs_score != null && vs.rs_score >= rules.strongRsMin) {
      factors.push({
        label: 'Beating its sector',
        value: `${vs.rs_score}/100`,
        tone: 'positive',
      })
    }
  } else if (sectorBonus < 0) {
    factors.push({ label: 'Behind its sector', tone: 'negative' })
  }

  return sectorBonus
}

function resolveTarget(
  f: StockFundamentals,
  current_price: number,
  buy_ratio: number,
  source: PickSourceTag,
  research: StockResearchSnapshot | null,
): {
  target_mean: number
  target_low: number | null
  target_high: number | null
  upside_pct: number
  label: TargetLabel
  factor?: PickFactor
} | null {
  const rules = PICKS_SCORING_RULES

  if (f.target_price && f.target_price > 0 && isAnalystTargetSource(f.target_source)) {
    const upside_pct = ((f.target_price - current_price) / current_price) * 100
    if (upside_pct <= 0) return null
    return {
      target_mean: f.target_price,
      target_low: f.target_low,
      target_high: f.target_high,
      upside_pct,
      label: 'analyst',
    }
  }

  if (f.target_mean && f.target_mean > 0 && !f.target_source) {
    const upside_pct = ((f.target_mean - current_price) / current_price) * 100
    if (upside_pct <= 0) return null
    return {
      target_mean: f.target_mean,
      target_low: f.target_low,
      target_high: f.target_high,
      upside_pct,
      label: 'analyst',
    }
  }

  if (
    allowMomentumTarget(source, research) &&
    buy_ratio >= rules.gates.momentumMinBuyRatio &&
    (f.change_30d_pct ?? 0) > rules.gates.momentumMin30dPct
  ) {
    const upside_pct = Math.min(f.change_30d_pct ?? 12, rules.gates.momentumMaxUpsidePct)
    return {
      target_mean: current_price * (1 + upside_pct / 100),
      target_low: null,
      target_high: null,
      upside_pct,
      label: 'momentum',
      factor: { label: 'Uptrend + analyst support', tone: 'positive' },
    }
  }

  if (f.week52_high && f.week52_high > current_price) {
    const upside_pct = ((f.week52_high - current_price) / current_price) * 100
    if (upside_pct > 0) {
      return {
        target_mean: f.week52_high,
        target_low: null,
        target_high: null,
        upside_pct,
        label: '52w_high',
        factor: { label: 'Room to 52-week high', tone: 'positive' },
      }
    }
  }

  return null
}

function applySignalBonuses(
  f: StockFundamentals,
  current_price: number,
  factors: PickFactor[],
): number {
  const rules = PICKS_SCORING_RULES
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

function addUpsideScore(
  target: { label: TargetLabel; upside_pct: number },
  score: number,
  factors: PickFactor[],
  momentumUpsidePointsCap: number | null,
): number {
  const rules = PICKS_SCORING_RULES
  const upside_pct = target.upside_pct

  if (target.label === 'analyst' || target.label === '52w_high') {
    const tier = rules.upsideAnalyst.tiers.find((t) => upside_pct > t.minPct)
    if (tier) {
      score += tier.points
      factors.push({ label: `+${upside_pct.toFixed(0)}% room to target`, tone: 'positive' })
    }
    return score
  }

  let momentumPoints: number =
    upside_pct >= rules.upsideAnalyst.momentumMinPct
      ? rules.upsideAnalyst.momentumFallbackPoints
      : rules.upsideAnalyst.momentumLowPoints

  if (momentumUpsidePointsCap != null) {
    momentumPoints = Math.min(momentumPoints, momentumUpsidePointsCap)
  }

  score += momentumPoints
  return score
}

function buildScoredPick(input: PickScoreInput, options: BuildPickOptions): ScoredPick | null {
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
  const rules = PICKS_SCORING_RULES
  const factors: PickFactor[] = []
  let score = 0

  if (current_price <= 0) return null

  if (isEarningsExclusionWindow(research)) return null

  const analyst_total = (f.analyst_buy ?? 0) + (f.analyst_hold ?? 0) + (f.analyst_sell ?? 0)
  if (analyst_total < PICKS_MIN_ANALYSTS) return null

  const sell_ratio = (f.analyst_sell ?? 0) / analyst_total
  if (sell_ratio > rules.gates.maxSellRatio) return null

  if (f.news_sentiment != null && f.news_sentiment < rules.gates.minNewsSentiment) return null

  const buy_ratio = (f.analyst_buy ?? 0) / analyst_total
  const target = resolveTarget(f, current_price, buy_ratio, candidate.source, research)
  if (!target) return null

  if (target.factor) factors.push(target.factor)
  const upside_pct = target.upside_pct
  if (upside_pct <= 0) return null

  score = addUpsideScore(target, score, factors, options.momentumUpsidePointsCap)

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

  const pb = rules.pullback14d
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

  score += applySignalBonuses(f, current_price, factors)

  const vs_sector = buildPickVsSector(candidate, f, benchmark)
  score += applyVsSectorScore(vs_sector, candidate.sector, factors)

  score += applyResearchScore(researchContext, candidate.sector, factors)

  if (score < options.minScore) return null

  const support = f.support_20d ?? current_price * 0.97
  const entry_low = Math.max(support * 1.005, current_price * 0.97)
  const entry_high = current_price

  let confidence: Pick['confidence'] = 'low'
  if (analyst_total >= rules.confidence.highMinAnalysts && buy_ratio > rules.confidence.highMinBuyRatio) {
    confidence = 'high'
  } else if (analyst_total >= rules.confidence.mediumMinAnalysts && buy_ratio > rules.confidence.mediumMinBuyRatio) {
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

  return {
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
    target_label: target.label,
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
    source: candidate.source,
    ownership,
  }
}

export function scorePick(input: PickScoreInput): ScoredPick | null {
  return scoreUnifiedPick(input)
}

function applyDayMoveAndTrendBonuses(
  pick: ScoredPick,
  f: StockFundamentals,
  change_1d_pct: number | null,
): ScoredPick {
  const dRules = PICKS_DISCOVERY_RULES
  let score = pick.score
  let factors = pick.factors

  if (change_1d_pct != null && change_1d_pct >= dRules.minDayMovePct) {
    const dayTier = dRules.dayMoveTiers.find((t) => change_1d_pct >= t.min)
    if (dayTier) {
      score += dayTier.points
      factors = [
        {
          label: 'Big move today',
          value: `${change_1d_pct >= 0 ? '+' : ''}${change_1d_pct.toFixed(1)}% today`,
          tone: 'positive',
        },
        ...factors.filter((x) => x.label !== 'Big move today'),
      ]
    }
  }

  const d30 = f.change_30d_pct
  if (d30 != null && d30 > dRules.monthTrend.strongMin) {
    score += dRules.monthTrend.strongPoints
    factors = [
      ...factors,
      { label: 'Up over 30 days', value: `+${d30.toFixed(0)}%`, tone: 'positive' },
    ]
  } else if (d30 != null && d30 > dRules.monthTrend.moderateMin) {
    score += dRules.monthTrend.moderatePoints
  }

  return { ...pick, score, factors }
}

/** Same formula for every source — watchlist membership only changes the source badge. */
export function scoreUnifiedPick(input: PickScoreInput): ScoredPick | null {
  const base = buildScoredPick(input, {
    minScore: PICKS_MIN_SCORE,
    momentumUpsidePointsCap: PICKS_MOMENTUM_TARGET_MAX_UPSIDE_POINTS,
  })
  if (!base) return null

  const withBonuses = applyDayMoveAndTrendBonuses(base, input.fundamentals, input.change_1d_pct)
  if (withBonuses.score < PICKS_MIN_SCORE) return null
  return withBonuses
}

/** Same pick shape as Picks narratives — skips score threshold only (for trending blurbs). */
export function buildNarrativeScoredPick(input: PickScoreInput): ScoredPick | null {
  const base = buildScoredPick(input, {
    minScore: Number.NEGATIVE_INFINITY,
    momentumUpsidePointsCap: PICKS_MOMENTUM_TARGET_MAX_UPSIDE_POINTS,
  })
  if (!base) return null
  return applyDayMoveAndTrendBonuses(base, input.fundamentals, input.change_1d_pct)
}

export function scoreDiscoveryPick(input: DiscoveryPickInput): ScoredPick | null {
  const { mover, current_price, change_1d_pct, fundamentals: f, benchmark, researchContext } = input
  const dRules = PICKS_DISCOVERY_RULES

  if (change_1d_pct < dRules.minDayMovePct) return null
  if (!f) return null

  const buy = f.analyst_buy ?? 0
  const hold = f.analyst_hold ?? 0
  const sell = f.analyst_sell ?? 0
  const total = buy + hold + sell
  if (total < dRules.minAnalysts) return null
  if (buy / total < dRules.minBuyRatio) return null

  const research = researchContext?.research ?? null
  if (!passesDiscoveryResearchQualityGate(research)) return null

  const candidate: PickCandidate = {
    ticker: mover.ticker,
    company_name: mover.company_name,
    sector: mover.sector,
    source: 'discovery',
  }

  const pick = scoreUnifiedPick({
    candidate,
    current_price,
    change_1d_pct,
    change_1d_session: input.change_1d_session,
    fundamentals: f,
    ownership: null,
    benchmark,
    researchContext,
  })

  if (!pick) return null
  return { ...pick, source: 'discovery' }
}

const CONFIDENCE_RANK: Record<Pick['confidence'], number> = {
  high: 3,
  medium: 2,
  low: 1,
}

/** Rank 1 = highest score across all sources (watchlist, portfolio, strong movers). */
export function rankAllPicks(scored: ScoredPick[], limit = PICKS_MAX_RESULTS): ScoredPick[] {
  return [...scored]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      const conf = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence]
      if (conf !== 0) return conf
      if (b.upside_pct !== a.upside_pct) return b.upside_pct - a.upside_pct
      return (b.change_1d_pct ?? 0) - (a.change_1d_pct ?? 0)
    })
    .slice(0, limit)
}

/** @deprecated Use rankAllPicks() */
export function rankPicks(scored: ScoredPick[], limit = PICKS_MAX_RESULTS): ScoredPick[] {
  return rankAllPicks(scored, limit)
}

/** @deprecated Use rankAllPicks() */
export function rankDiscoveryPicks(scored: ScoredPick[], limit = PICKS_DISCOVERY_MAX): ScoredPick[] {
  return rankAllPicks(scored, limit)
}
