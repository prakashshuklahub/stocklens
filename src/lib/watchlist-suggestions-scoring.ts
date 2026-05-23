/**
 * Trending card scoring — edit this file to change how market movers are ranked.
 *
 * Input: market screener quotes (day gainers + most active) + fundamentals.
 * Does NOT know about the user's watchlist — filter watchlist tickers in the API route only.
 */

import type { MoverQuote } from '@/lib/market-movers'
import type { WatchlistSector } from '@/lib/sectors'
import type { StockFundamentals } from '@/types'

// ── Tunable constants ─────────────────────────────────────────────────────────

export const TRENDING_MIN_SCORE = 24
export const TRENDING_MAX_SCORE = 60
export const TRENDING_STRONG_SCORE = 35
export const TRENDING_STRONG_MIN_SLOTS = 5
export const TRENDING_MIN_PRICE = 5

export const TRENDING_SCORING_RULES = {
  analyst: { minCount: 5, minBuyRatio: 0.45, weakBuyPenalty: 8 },
  dayMove: {
    tiers: [
      { min: 8, points: 25 },
      { min: 5, points: 18 },
      { min: 3, points: 10 },
    ],
  },
  monthTrend: { strongMin: 15, strongPoints: 15, moderateMin: 8, moderatePoints: 8 },
  buyConsensus: { strongRatio: 0.65, strongPoints: 22, moderateRatio: 0.5, moderatePoints: 14 },
  news: { minSentiment: 0.25, points: 10 },
  near52wHigh: { proximityRatio: 0.97, points: 10 },
} as const

/** Max ranked rows stored in the global trending cache. */
export const TRENDING_GLOBAL_RANK_LIMIT = 15

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrendingScoreInput {
  mover: MoverQuote
  fundamentals: StockFundamentals | null
}

export interface ScoredSuggestion {
  ticker: string
  company_name: string
  sector: WatchlistSector
  current_price: number
  change_1d_pct: number
  change_30d_pct: number | null
  upside_pct: number | null
  analyst_buy: number
  analyst_hold: number
  analyst_sell: number
  analyst_total: number
  score: number
  source: MoverQuote['source']
  headline: string
  news_sentiment: number | null
  near_52w_high: boolean
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveUpsideTarget(
  price: number,
  fundamentals: StockFundamentals | null,
): number | null {
  if (fundamentals?.target_mean && fundamentals.target_mean > price) return fundamentals.target_mean
  if (fundamentals?.target_price && fundamentals.target_price > price) return fundamentals.target_price
  return null
}

/** Card headline from day change — updated again when live prices overlay. */
export function trendingHeadline(change_1d_pct: number, buyRatio: number): string {
  const momentum = change_1d_pct >= 8 ? 'Hot momentum' : 'Strong day'
  const consensus =
    buyRatio >= 0.65 ? 'strong buy consensus' : buyRatio >= 0.45 ? 'buy ratings' : 'mixed ratings'
  const sign = change_1d_pct >= 0 ? '+' : ''
  const pct = change_1d_pct >= 8 ? change_1d_pct.toFixed(0) : change_1d_pct.toFixed(1)
  return `${momentum} — ${sign}${pct}% · ${consensus}`
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export function scoreTrendingCandidate(input: TrendingScoreInput): ScoredSuggestion | null {
  const { mover, fundamentals: f } = input
  const price = mover.price
  const rules = TRENDING_SCORING_RULES

  if (price < TRENDING_MIN_PRICE) return null

  const buy = f?.analyst_buy ?? 0
  const hold = f?.analyst_hold ?? 0
  const sell = f?.analyst_sell ?? 0
  const total = buy + hold + sell
  if (total < rules.analyst.minCount) return null

  const buyRatio = buy / total
  const d1 = mover.change_1d_pct
  const d30 = f?.change_30d_pct ?? null

  // Trending cards are bullish-only — negative movers are out of scope.
  if (d1 < 0) return null

  const dayTier = rules.dayMove.tiers.find((t) => d1 >= t.min)
  if (!dayTier) return null

  let score: number = dayTier.points

  if (buyRatio < rules.analyst.minBuyRatio) score -= rules.analyst.weakBuyPenalty

  if (d30 != null && d30 > rules.monthTrend.strongMin) score += rules.monthTrend.strongPoints
  else if (d30 != null && d30 > rules.monthTrend.moderateMin) score += rules.monthTrend.moderatePoints

  if (buyRatio >= rules.buyConsensus.strongRatio) score += rules.buyConsensus.strongPoints
  else if (buyRatio >= rules.buyConsensus.moderateRatio) score += rules.buyConsensus.moderatePoints

  if (f?.news_sentiment != null && f.news_sentiment > rules.news.minSentiment) {
    score += rules.news.points
  }

  const near_52w_high = Boolean(f?.week52_high && price >= f.week52_high * rules.near52wHigh.proximityRatio)
  if (near_52w_high) score += rules.near52wHigh.points

  score = Math.min(score, TRENDING_MAX_SCORE)

  if (score < TRENDING_MIN_SCORE) return null

  const target = resolveUpsideTarget(price, f)
  const upside_pct = target != null ? ((target - price) / price) * 100 : null

  return {
    ticker: mover.ticker,
    company_name: mover.company_name,
    sector: mover.sector,
    current_price: price,
    change_1d_pct: d1,
    change_30d_pct: d30,
    upside_pct,
    analyst_buy: buy,
    analyst_hold: hold,
    analyst_sell: sell,
    analyst_total: total,
    score,
    source: mover.source,
    headline: trendingHeadline(d1, buyRatio),
    news_sentiment: f?.news_sentiment ?? null,
    near_52w_high,
  }
}

export function rankTrendingSuggestions(
  scored: ScoredSuggestion[],
  limit = TRENDING_GLOBAL_RANK_LIMIT,
): ScoredSuggestion[] {
  const sorted = [...scored].sort(
    (a, b) => b.score - a.score || b.change_1d_pct - a.change_1d_pct || a.ticker.localeCompare(b.ticker),
  )

  const strong = sorted.filter((s) => s.score >= TRENDING_STRONG_SCORE)
  const rest = sorted.filter((s) => s.score < TRENDING_STRONG_SCORE)

  const maxWeakSlots =
    strong.length >= TRENDING_STRONG_MIN_SLOTS
      ? Math.max(0, limit - TRENDING_STRONG_MIN_SLOTS)
      : limit

  const picked: ScoredSuggestion[] = []
  for (const s of strong) {
    if (picked.length >= limit) break
    picked.push(s)
  }
  let weakAdded = 0
  for (const s of rest) {
    if (picked.length >= limit) break
    if (weakAdded >= maxWeakSlots) break
    picked.push(s)
    weakAdded += 1
  }

  return picked
}
