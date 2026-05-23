// Trending card blurbs (mechanical + Gemini context).
// Scoring rules: @/lib/watchlist-suggestions-scoring

import type { ScoredSuggestion } from '@/lib/watchlist-suggestions-scoring'
import {
  rankTrendingSuggestions,
  scoreTrendingCandidate,
  trendingHeadline,
  TRENDING_GLOBAL_RANK_LIMIT,
  TRENDING_MIN_SCORE,
  TRENDING_MAX_SCORE,
  TRENDING_STRONG_SCORE,
  TRENDING_STRONG_MIN_SLOTS,
  TRENDING_SCORING_RULES,
} from '@/lib/watchlist-suggestions-scoring'

export type { ScoredSuggestion, TrendingScoreInput } from '@/lib/watchlist-suggestions-scoring'
export {
  rankTrendingSuggestions,
  scoreTrendingCandidate,
  trendingHeadline,
  TRENDING_GLOBAL_RANK_LIMIT,
  TRENDING_MIN_SCORE,
  TRENDING_MAX_SCORE,
  TRENDING_STRONG_SCORE,
  TRENDING_STRONG_MIN_SLOTS,
  TRENDING_SCORING_RULES,
}

/** True when the blurb repeats stats already shown on the suggestion card. */
export function isRedundantBlurb(s: ScoredSuggestion, reason: string): boolean {
  const r = reason.toLowerCase()
  const nameRoot = s.company_name.toLowerCase().split(',')[0]?.trim() ?? ''
  if (nameRoot.length >= 6 && r.includes(nameRoot.slice(0, 12))) return true
  if (r.includes(s.ticker.toLowerCase())) return true
  if (/\d+\s*\/\s*\d+/.test(reason)) return true
  if (/\d+\s+of\s+\d+\s+analyst/i.test(reason)) return true
  if (/[+\-]?\d+(\.\d+)?%\s*(today|over\s+30)/i.test(reason)) return true
  if (/worth tracking|analysts rate buy/i.test(reason)) return true
  return false
}

export function monthTrendPhrase(d30: number | null): string | null {
  if (d30 == null) return null
  if (d30 >= 20) return 'strong multi-week uptrend'
  if (d30 >= 8) return 'positive month trend'
  if (d30 >= 0) return 'flat-to-up over the past month'
  return 'recent month pullback'
}

export function newsTonePhrase(sentiment: number | null): string | null {
  if (sentiment == null) return null
  if (sentiment > 0.35) return 'news tone skews positive'
  if (sentiment < -0.2) return 'headlines have been cautious lately'
  return null
}

export function analystConsensusLabel(s: ScoredSuggestion): 'strong buy' | 'buy' | 'mixed' {
  const ratio = s.analyst_buy / s.analyst_total
  if (ratio >= 0.8 && s.analyst_total >= 6 && (s.analyst_sell ?? 0) === 0) return 'strong buy'
  if (ratio >= 0.55) return 'buy'
  return 'mixed'
}

export function mechanicalReason(s: ScoredSuggestion): string {
  const consensus = analystConsensusLabel(s)
  const screen = s.source === 'gainers' ? "today's day-gainers screen" : 'the most-active list'
  const month = monthTrendPhrase(s.change_30d_pct)
  const news = newsTonePhrase(s.news_sentiment)
  const idx = (s.ticker.charCodeAt(0) + s.ticker.charCodeAt(s.ticker.length - 1)) % 4
  const near = s.near_52w_high ? ', trading near its 52-week high' : ''
  const monthBit = month ? ` with a ${month}` : ''
  const newsBit = news ? `; ${news}` : ''

  if (consensus === 'strong buy') {
    const lead =
      s.analyst_sell === 0
        ? 'Near-unanimous strong-buy Street view with no sell ratings'
        : 'Street skews strong buy'
    const variants = [
      `${lead} — surfaced on ${screen}${monthBit}.`,
      `Hot name on ${screen}; ${lead.toLowerCase()}${newsBit}.`,
      `${lead} on unusual volume today${near}.`,
      `Trending on ${screen} with ${lead.toLowerCase()}${monthBit}${newsBit}.`,
    ]
    return variants[idx]!
  }

  if (consensus === 'buy') {
    const variants = [
      `Solid buy-side consensus — picked up on ${screen}${monthBit}.`,
      `On ${screen} with mostly buy ratings${newsBit}.`,
      `Buy-leaning Street view amid today's move${near}.`,
      `Surfaced on ${screen}; analysts lean buy${monthBit}.`,
    ]
    return variants[idx]!
  }

  const variants = [
    `Mixed analyst picture despite the pop — still on ${screen}.`,
    `Split Street view on ${screen}; momentum may be ahead of ratings${newsBit}.`,
  ]
  return variants[idx % variants.length]!
}

export function suggestionBlurbContext(s: ScoredSuggestion) {
  return {
    ticker: s.ticker,
    analyst_consensus: analystConsensusLabel(s),
    mover_screen: (s.source === 'gainers' ? 'day gainers' : 'most active') as 'day gainers' | 'most active',
    sector: s.sector,
    month_trend: monthTrendPhrase(s.change_30d_pct),
    news_tone: newsTonePhrase(s.news_sentiment),
    near_52w_high: s.near_52w_high,
  }
}
