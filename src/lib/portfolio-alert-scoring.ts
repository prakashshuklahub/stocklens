/**
 * Portfolio sell-review scoring — edit this file to change alert rules.
 *
 * Conservative review flags (not a "sell now" engine). A holding must hit
 * several independent bearish factors before it appears on the portfolio scan.
 *
 * The API route loads holdings + prices + fundamentals, then calls these functions.
 *
 * Bearish factors (negative chips):
 *   • Down on cost and still sliding
 *   • Underwater vs your cost
 *   • Sharp 30-day decline
 *   • Recent weeks still weak
 *   • No meaningful bounce yet
 *   • Heavy sell ratings
 *   • Negative news tone
 *   • Below recent support
 *   • Near 52-week low
 *   • Above typical target
 *
 * Bullish offsets (positive chips, reduce score):
 *   • Strong buy ratings
 *   • Healthy 30-day trend
 *   • Near 52-week high
 */

import type { PickFactor, PortfolioAlert, PortfolioHolding, StockFundamentals } from '@/types'

// ── Tunable constants ─────────────────────────────────────────────────────────

/** Minimum distinct bearish factors before an alert is shown. */
export const MIN_BEARISH_FACTORS = 2

/** Net score must reach this to show a "Watch" alert. */
export const WATCH_SCORE_THRESHOLD = 24

/** Score + factor count for red "Review" severity (buffer above Watch). */
export const RED_SCORE_THRESHOLD = 42
export const RED_MIN_BEARISH_FACTORS = 3

/** Cap gross score before severity bucketing. */
export const MAX_ALERT_SCORE = 80

/** Bullish offsets cannot erase more than this share of gross bearish points. */
export const MAX_OFFSET_RATIO = 0.5

/**
 * support_20d is recomputed from Yahoo 1y candles on fundamentals refresh
 * (~30 min during regular US hours). Skip the chip if row data is older.
 */
export const SUPPORT_DATA_MAX_AGE_HOURS = 36

export const ALERT_RULES = {
  position: {
    underwaterAndSliding: { maxPnlPct: -15, max30dPct: -5, points: 22 },
    underwater: { maxPnlPct: -12, points: 14 },
    noBounce: { maxPnlPct: -10, min30dPct: -18, max30dPct: 2, points: 14 },
  },
  trend: {
    sharp30d: { max30dPct: -12, points: 18 },
    weak14d: { max14dPct: -8, require30dNegative: true, points: 12 },
    healthy30d: { min30dPct: 12, offsetPoints: 18 },
  },
  analyst: {
    /** Needs 5+ analysts and 35%+ sell — avoids 1-of-3 false positives. */
    heavySell: { minAnalysts: 5, minSellRatio: 0.35, points: 20 },
    strongBuy: { minAnalysts: 8, minBuyRatio: 0.65, offsetPoints: 22 },
  },
  news: { maxSentiment: -0.35, points: 14 },
  technical: {
    belowSupport: { supportMultiplier: 0.97, points: 12 },
    near52wLow: { lowMultiplier: 1.05, points: 14 },
    near52wHigh: { highMultiplier: 0.95, offsetPoints: 15 },
    /** Skip when position is up a lot — stale targets often lag strong runners. */
    aboveTarget: { targetMultiplier: 1.08, maxPositionPnlPct: 25, points: 10 },
  },
} as const

export const ALERT_HEADLINES = {
  watch: 'On watch — several weak signals',
  red: 'Worth a careful review — weak signals may persist for months',
} as const

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AlertScoreInput {
  holding: PortfolioHolding
  current_price: number
  fundamentals: StockFundamentals | null
}

export type ScoredAlert = Omit<PortfolioAlert, 'review_reason' | 'caveat' | 'narrative_source'>

type FundamentalsRow = StockFundamentals & { fetched_at?: string | null }

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Prefer resolved `target_price` (best single reference from analyst chain).
 * Fall back to Finnhub consensus `target_mean` when unset.
 */
function resolveRefTarget(f: StockFundamentals): number | null {
  return f.target_price ?? f.target_mean
}

function isSupportDataFresh(f: StockFundamentals | null): boolean {
  if (!f?.support_20d) return false
  const fetchedAt = (f as FundamentalsRow).fetched_at
  if (!fetchedAt) return false
  const ageHours = (Date.now() - new Date(fetchedAt).getTime()) / 3_600_000
  return ageHours >= 0 && ageHours <= SUPPORT_DATA_MAX_AGE_HOURS
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export function scorePortfolioAlert(input: AlertScoreInput): ScoredAlert | null {
  const { holding, current_price, fundamentals: f } = input
  if (current_price <= 0) return null

  const factors: PickFactor[] = []
  let grossBearish = 0
  let totalOffsets = 0
  let bearishCount = 0
  const rules = ALERT_RULES

  const cost = holding.avg_cost_basis
  const positionPnlPct = cost > 0 ? ((current_price - cost) / cost) * 100 : 0
  const invested = cost * holding.quantity
  const positionValue = current_price * holding.quantity

  const buy = f?.analyst_buy ?? 0
  const hold = f?.analyst_hold ?? 0
  const sell = f?.analyst_sell ?? 0
  const analystTotal = buy + hold + sell
  const sellRatio = analystTotal > 0 ? sell / analystTotal : 0
  const buyRatio = analystTotal > 0 ? buy / analystTotal : 0
  const change30d = f?.change_30d_pct ?? null

  function bearish(points: number, factor: PickFactor) {
    grossBearish += points
    bearishCount++
    factors.push(factor)
  }

  function bullishOffset(points: number, factor: PickFactor) {
    totalOffsets += points
    factors.push(factor)
  }

  // ── Position pain (mutually exclusive chain) ────────────────────────────────
  let slidingRuleFired = false

  if (
    positionPnlPct <= rules.position.underwaterAndSliding.maxPnlPct &&
    change30d !== null &&
    change30d < rules.position.underwaterAndSliding.max30dPct
  ) {
    slidingRuleFired = true
    bearish(rules.position.underwaterAndSliding.points, {
      label: 'Down on cost and still sliding',
      value: `${positionPnlPct.toFixed(0)}% position · ${change30d.toFixed(0)}% in 30d`,
      tone: 'negative',
    })
  } else if (positionPnlPct <= rules.position.underwater.maxPnlPct) {
    bearish(rules.position.underwater.points, {
      label: 'Underwater vs your cost',
      value: `${positionPnlPct.toFixed(0)}%`,
      tone: 'negative',
    })
  } else if (
    positionPnlPct <= rules.position.noBounce.maxPnlPct &&
    change30d !== null &&
    change30d < rules.position.noBounce.max30dPct &&
    change30d > rules.position.noBounce.min30dPct
  ) {
    bearish(rules.position.noBounce.points, {
      label: 'No meaningful bounce yet',
      value: `${positionPnlPct.toFixed(0)}% vs cost · flat 30d`,
      tone: 'negative',
    })
  }

  // ── Trend (sharp30d skipped when sliding rule already captured 30d weakness) ─
  if (
    !slidingRuleFired &&
    change30d !== null &&
    change30d < rules.trend.sharp30d.max30dPct
  ) {
    bearish(rules.trend.sharp30d.points, {
      label: 'Sharp 30-day decline',
      value: `${change30d.toFixed(0)}% in 30d`,
      tone: 'negative',
    })
  } else if (
    f?.change_14d_pct != null &&
    f.change_14d_pct < rules.trend.weak14d.max14dPct &&
    change30d !== null &&
    change30d < 0
  ) {
    bearish(rules.trend.weak14d.points, {
      label: 'Recent weeks still weak',
      value: `${f.change_14d_pct.toFixed(0)}% in 14d`,
      tone: 'negative',
    })
  }

  if (analystTotal >= rules.analyst.heavySell.minAnalysts && sellRatio >= rules.analyst.heavySell.minSellRatio) {
    bearish(rules.analyst.heavySell.points, {
      label: 'Heavy sell ratings',
      value: `${sell} of ${analystTotal} analysts`,
      tone: 'negative',
    })
  }

  if (f?.news_sentiment != null && f.news_sentiment < rules.news.maxSentiment) {
    bearish(rules.news.points, { label: 'Negative news tone', tone: 'negative' })
  }

  if (
    isSupportDataFresh(f) &&
    f?.support_20d &&
    current_price < f.support_20d * rules.technical.belowSupport.supportMultiplier
  ) {
    bearish(rules.technical.belowSupport.points, { label: 'Below recent support', tone: 'negative' })
  }

  if (f?.week52_low && f.week52_high && current_price <= f.week52_low * rules.technical.near52wLow.lowMultiplier) {
    bearish(rules.technical.near52wLow.points, { label: 'Near 52-week low', tone: 'negative' })
  }

  const refTarget = f ? resolveRefTarget(f) : null
  if (
    refTarget &&
    positionPnlPct < rules.technical.aboveTarget.maxPositionPnlPct &&
    current_price > refTarget * rules.technical.aboveTarget.targetMultiplier
  ) {
    bearish(rules.technical.aboveTarget.points, {
      label: 'Above typical target',
      value: `${(((current_price - refTarget) / refTarget) * 100).toFixed(0)}% over ref.`,
      tone: 'negative',
    })
  }

  if (buyRatio > rules.analyst.strongBuy.minBuyRatio && analystTotal >= rules.analyst.strongBuy.minAnalysts) {
    bullishOffset(rules.analyst.strongBuy.offsetPoints, {
      label: 'Strong buy ratings',
      value: `${buy} of ${analystTotal}`,
      tone: 'positive',
    })
  }

  if (change30d !== null && change30d > rules.trend.healthy30d.min30dPct) {
    bullishOffset(rules.trend.healthy30d.offsetPoints, {
      label: 'Healthy 30-day trend',
      value: `+${change30d.toFixed(0)}%`,
      tone: 'positive',
    })
  }

  if (f?.week52_high && current_price >= f.week52_high * rules.technical.near52wHigh.highMultiplier) {
    bullishOffset(rules.technical.near52wHigh.offsetPoints, {
      label: 'Near 52-week high',
      tone: 'positive',
    })
  }

  const cappedOffset = Math.min(totalOffsets, grossBearish * MAX_OFFSET_RATIO)
  let score = grossBearish - cappedOffset

  // Offsets cannot fully cancel a position that already earned a watch-level bearish case.
  if (bearishCount >= MIN_BEARISH_FACTORS && grossBearish >= WATCH_SCORE_THRESHOLD) {
    score = Math.max(score, WATCH_SCORE_THRESHOLD)
  }

  score = Math.min(score, MAX_ALERT_SCORE)

  if (bearishCount < MIN_BEARISH_FACTORS || score < WATCH_SCORE_THRESHOLD) return null

  const severity: PortfolioAlert['severity'] =
    score >= RED_SCORE_THRESHOLD && bearishCount >= RED_MIN_BEARISH_FACTORS ? 'red' : 'watch'

  return {
    ticker: holding.ticker,
    company_name: holding.company_name,
    severity,
    score,
    headline: severity === 'red' ? ALERT_HEADLINES.red : ALERT_HEADLINES.watch,
    holding: {
      quantity: holding.quantity,
      avg_cost_basis: cost,
      current_price,
      position_pnl_pct: positionPnlPct,
      position_value: positionValue,
      invested,
    },
    factors,
  }
}

// ── Sorting ───────────────────────────────────────────────────────────────────

export function rankAlerts(alerts: ScoredAlert[]): ScoredAlert[] {
  const severityRank = { red: 2, watch: 1 }
  // Spread copy — do not mutate caller's array.
  return [...alerts].sort((a, b) => {
    const byScore = b.score - a.score
    if (byScore !== 0) return byScore
    return severityRank[b.severity] - severityRank[a.severity]
  })
}
