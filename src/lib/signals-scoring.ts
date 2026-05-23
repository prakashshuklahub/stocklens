/**
 * Signals scoring — edit this file to change how watchlist stocks are ranked.
 *
 * The API route (`/api/signals`) loads prices, fundamentals, and news, then calls
 * these pure functions. No HTTP, DB, or fetch logic belongs here.
 *
 * Pipeline:
 *   1. computeBaseScore()      — rules from price + fundamentals
 *   2. pickNewsTargetTickers() — who gets RSS (uses base score)
 *   3. applyFreshNewsBonus()   — tiered RSS freshness + headline tone
 *   4. signalBiasFromScore()   — bullish / bearish / quiet
 */

import type { Signal, SignalNewsItem, SignalReason, StockFundamentals } from '@/types'

// ── Tunable constants (review changes here) ───────────────────────────────────

/** |score| must exceed this to land in bullish/bearish bucket. */
export const BIAS_THRESHOLD = 20

/** |score| must exceed this to be included in the movers news pool. */
export const NEWS_MOVER_THRESHOLD = 20

/** Max tickers to fetch Google News for in each pool (movers + quiet). */
export const NEWS_TARGET_LIMIT = 30

/** Soft cap on base score magnitude before fresh-news bonus. */
export const MAX_ABS_SCORE = 75

/** Freshest headline age → bonus points (replaces flat 48h ±5). */
export const FRESH_NEWS_TIERS = [
  { maxHours: 6, bonus: 5 },
  { maxHours: 24, bonus: 3 },
  { maxHours: 48, bonus: 1 },
] as const

export const SCORING_RULES = {
  dayMove: { minAbsPct: 5, points: 25 },
  week52High: { maxPctFromHigh: 3, points: 20 },
  week52Low: { maxPctFromLow: 3, points: 20 },
  targetUpside: { minPct: 20, points: 15 },
  targetDownside: { maxPct: -10, points: 15 },
  analyst: {
    minCount: 5,
    strongBuyRatio: 0.6,
    buyPoints: 10,
    /** Symmetric-ish to strongBuyRatio — needs 40%+ sell ratings to fire bearish. */
    strongSellRatio: 0.4,
    sellPoints: 15,
  },
  trend30d: { minAbsPct: 15, points: 10 },
  finnhubSentiment: { bullishMin: 0.5, bearishMax: -0.3, points: 15 },
} as const

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SignalScoreInput {
  change_1d_pct: number | null
  price: number | null
  /** When day % is from extended hours, chip shows pre-mkt / after-hrs instead of today. */
  extendedSession?: 'pre' | 'post'
  fundamentals: StockFundamentals | null
}

export interface BaseScoreResult {
  score: number
  reasons: SignalReason[]
}

export interface ScoredWatchlistRow {
  ticker: string
  score: number
  change_1d_pct: number | null
}

export type FreshNewsTone = 'positive' | 'negative' | 'neutral'

// ── Helpers ───────────────────────────────────────────────────────────────────

function dayMoveLabel(changePct: number, extendedSession?: 'pre' | 'post'): string {
  const suffix =
    extendedSession === 'pre' ? ' pre-mkt' :
    extendedSession === 'post' ? ' after-hrs' :
    ' today'
  const signed = `${changePct > 0 ? '+' : ''}${changePct.toFixed(1)}%`
  return `${signed}${suffix}`
}

/**
 * Prefer resolved `target_price` (best available single target from FMP/Finnhub/52W chain).
 * Fall back to Finnhub consensus `target_mean` when target_price is unset.
 */
function resolveRefTarget(f: StockFundamentals): number | null | undefined {
  return f.target_price ?? f.target_mean
}

function clampScore(score: number): number {
  return Math.max(-MAX_ABS_SCORE, Math.min(MAX_ABS_SCORE, score))
}

// ── Stage 1: base score ───────────────────────────────────────────────────────

export function computeBaseScore(input: SignalScoreInput): BaseScoreResult {
  const reasons: SignalReason[] = []
  let score = 0
  const f = input.fundamentals
  const price = input.price
  const d1 = input.change_1d_pct
  const rules = SCORING_RULES

  if (d1 != null && Math.abs(d1) > rules.dayMove.minAbsPct) {
    const points = rules.dayMove.points
    const label = dayMoveLabel(d1, input.extendedSession)
    if (d1 > 0) {
      score += points
      reasons.push({ label, tone: 'bullish' })
    } else {
      score -= points
      reasons.push({ label, tone: 'bearish' })
    }
  }

  if (f?.week52_high && f?.week52_low && price) {
    const fromHigh = ((f.week52_high - price) / f.week52_high) * 100
    const fromLow = ((price - f.week52_low) / f.week52_low) * 100
    if (fromHigh <= rules.week52High.maxPctFromHigh) {
      score += rules.week52High.points
      reasons.push({ label: 'Near 52W high', tone: 'bullish' })
    } else if (fromLow >= 0 && fromLow <= rules.week52Low.maxPctFromLow) {
      score -= rules.week52Low.points
      reasons.push({ label: 'Near 52W low', tone: 'bearish' })
    }
  }

  const refTarget = f ? resolveRefTarget(f) : null
  if (refTarget && price) {
    const upside = ((refTarget - price) / price) * 100
    if (upside > rules.targetUpside.minPct) {
      score += rules.targetUpside.points
      reasons.push({ label: `+${upside.toFixed(0)}% to target`, tone: 'bullish' })
    } else if (upside < rules.targetDownside.maxPct) {
      score -= rules.targetDownside.points
      reasons.push({ label: `${upside.toFixed(0)}% to target`, tone: 'bearish' })
    }
  }

  const buy = f?.analyst_buy ?? 0
  const hold = f?.analyst_hold ?? 0
  const sell = f?.analyst_sell ?? 0
  const total = buy + hold + sell
  if (total >= rules.analyst.minCount) {
    const buyRatio = buy / total
    const sellRatio = sell / total
    if (buyRatio > rules.analyst.strongBuyRatio) {
      score += rules.analyst.buyPoints
      reasons.push({ label: 'Strong buy', tone: 'bullish' })
    } else if (sellRatio > rules.analyst.strongSellRatio) {
      score -= rules.analyst.sellPoints
      reasons.push({ label: 'Sell consensus', tone: 'bearish' })
    }
  }

  if (f?.change_30d_pct != null && Math.abs(f.change_30d_pct) > rules.trend30d.minAbsPct) {
    if (f.change_30d_pct > 0) {
      score += rules.trend30d.points
      reasons.push({ label: `+${f.change_30d_pct.toFixed(0)}% in 30d`, tone: 'bullish' })
    } else {
      score -= rules.trend30d.points
      reasons.push({ label: `${f.change_30d_pct.toFixed(0)}% in 30d`, tone: 'bearish' })
    }
  }

  if (f?.news_sentiment != null) {
    if (f.news_sentiment > rules.finnhubSentiment.bullishMin) {
      score += rules.finnhubSentiment.points
      reasons.push({ label: 'Positive news', tone: 'bullish' })
    } else if (f.news_sentiment < rules.finnhubSentiment.bearishMax) {
      score -= rules.finnhubSentiment.points
      reasons.push({ label: 'Negative news', tone: 'bearish' })
    }
  }

  return { score: clampScore(score), reasons }
}

// ── Stage 2: news target selection ────────────────────────────────────────────

export function pickNewsTargetTickers(rows: ScoredWatchlistRow[]): string[] {
  const moverTickers = rows
    .filter((x) => Math.abs(x.score) >= NEWS_MOVER_THRESHOLD)
    .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
    .slice(0, NEWS_TARGET_LIMIT)
    .map((x) => x.ticker)

  const quietTickers = rows
    .filter((x) => Math.abs(x.score) < NEWS_MOVER_THRESHOLD)
    .sort((a, b) => Math.abs(b.change_1d_pct ?? 0) - Math.abs(a.change_1d_pct ?? 0))
    .slice(0, NEWS_TARGET_LIMIT)
    .map((x) => x.ticker)

  return [...new Set([...moverTickers, ...quietTickers])]
}

// ── Stage 3: final score + bias ─────────────────────────────────────────────

const FRESH_NEWS_MAX_HOURS = FRESH_NEWS_TIERS[FRESH_NEWS_TIERS.length - 1].maxHours

export function getFreshNewsBonus(
  news: Pick<SignalNewsItem, 'published_at'>[],
  nowMs = Date.now(),
): number {
  const ageHours = news
    .map((n) => (nowMs - new Date(n.published_at).getTime()) / 3_600_000)
    .filter((h) => h >= 0 && h <= FRESH_NEWS_MAX_HOURS)
  if (!ageHours.length) return 0
  const minAge = Math.min(...ageHours)
  return FRESH_NEWS_TIERS.find((t) => minAge <= t.maxHours)?.bonus ?? 0
}

export function getFreshNewsTone(
  news: Pick<SignalNewsItem, 'published_at' | 'sentiment'>[],
  nowMs = Date.now(),
): FreshNewsTone {
  const fresh = news
    .filter((n) => {
      const ageHours = (nowMs - new Date(n.published_at).getTime()) / 3_600_000
      return ageHours >= 0 && ageHours <= FRESH_NEWS_MAX_HOURS
    })
    .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())

  if (!fresh.length) return 'neutral'
  if (fresh[0].sentiment === 'bullish') return 'positive'
  if (fresh[0].sentiment === 'bearish') return 'negative'
  return 'neutral'
}

export function applyFreshNewsBonus(
  baseScore: number,
  news: Pick<SignalNewsItem, 'published_at' | 'sentiment'>[],
  nowMs = Date.now(),
): number {
  const bonus = getFreshNewsBonus(news, nowMs)
  if (bonus === 0) return baseScore

  const tone = getFreshNewsTone(news, nowMs)
  if (tone === 'positive') return baseScore + bonus
  if (tone === 'negative') return baseScore - bonus
  return baseScore + (baseScore >= 0 ? bonus : -bonus)
}

export function signalBiasFromScore(finalScore: number): Signal['bias'] {
  if (finalScore > BIAS_THRESHOLD) return 'bullish'
  if (finalScore < -BIAS_THRESHOLD) return 'bearish'
  return 'quiet'
}

interface SignalsResponseBuckets {
  bullish: Signal[]
  bearish: Signal[]
  quiet: Signal[]
}

// ── Stage 4: bucket sorting ───────────────────────────────────────────────────

export function sortSignalsIntoBuckets(signals: Signal[]): Pick<SignalsResponseBuckets, 'bullish' | 'bearish' | 'quiet'> {
  const byAbsScore = (a: Signal, b: Signal) => Math.abs(b.score) - Math.abs(a.score)
  const byAbsDayMove = (a: Signal, b: Signal) =>
    Math.abs(b.change_1d_pct ?? 0) - Math.abs(a.change_1d_pct ?? 0) ||
    a.ticker.localeCompare(b.ticker)

  return {
    bullish: signals.filter((s) => s.bias === 'bullish').sort(byAbsScore),
    bearish: signals.filter((s) => s.bias === 'bearish').sort(byAbsScore),
    quiet: signals.filter((s) => s.bias === 'quiet').sort(byAbsDayMove),
  }
}
