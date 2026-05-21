// Score market movers for "add to watchlist" suggestions (not on user's list yet).

import type { MoverQuote } from '@/lib/market-movers'
import type { WatchlistSector } from '@/lib/sectors'
import type { StockFundamentals } from '@/types'

export interface SuggestionCandidate extends MoverQuote {
  fundamentals: StockFundamentals | null
}

export interface ScoredSuggestion {
  ticker: string
  company_name: string
  sector: WatchlistSector
  current_price: number
  change_1d_pct: number
  change_30d_pct: number | null
  upside_pct: number
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

const MIN_ANALYSTS = 5
const MIN_BUY_RATIO = 0.45
const MIN_SCORE = 24

export function scoreSuggestion(
  mover: MoverQuote,
  fundamentals: StockFundamentals | null,
): ScoredSuggestion | null {
  const price = mover.price
  if (price < 5) return null

  const buy = fundamentals?.analyst_buy ?? 0
  const hold = fundamentals?.analyst_hold ?? 0
  const sell = fundamentals?.analyst_sell ?? 0
  const total = buy + hold + sell
  if (total < MIN_ANALYSTS) return null

  const buyRatio = buy / total
  if (buyRatio < MIN_BUY_RATIO) return null

  let score = 0
  const d1 = mover.change_1d_pct
  const d30 = fundamentals?.change_30d_pct ?? null

  if (d1 >= 8) score += 25
  else if (d1 >= 5) score += 18
  else if (d1 >= 3) score += 10
  else return null

  if (d30 != null && d30 > 15) score += 15
  else if (d30 != null && d30 > 8) score += 8

  if (buyRatio >= 0.65) score += 18
  else if (buyRatio >= 0.5) score += 12

  if (fundamentals?.news_sentiment != null && fundamentals.news_sentiment > 0.25) {
    score += 10
  }

  if (fundamentals?.week52_high && price >= fundamentals.week52_high * 0.97) {
    score -= 12
  }

  if (score < MIN_SCORE) return null

  const target =
    fundamentals?.target_mean && fundamentals.target_mean > price
      ? fundamentals.target_mean
      : fundamentals?.week52_high && fundamentals.week52_high > price
        ? fundamentals.week52_high
        : price * (1 + Math.min(d30 ?? d1, 35) / 100)

  const upside_pct = ((target - price) / price) * 100
  const near_52w_high = Boolean(
    fundamentals?.week52_high && price >= fundamentals.week52_high * 0.97,
  )

  const headline =
    d1 >= 8
      ? `Hot momentum — +${d1.toFixed(0)}% today`
      : `Strong day — +${d1.toFixed(0)}% with buy ratings`

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
    headline,
    news_sentiment: fundamentals?.news_sentiment ?? null,
    near_52w_high,
  }
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

/** Plain-language Street consensus from buy/hold/sell counts (strong buy when overwhelmingly bullish). */
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

export function rankSuggestions(scored: ScoredSuggestion[], limit = 10): ScoredSuggestion[] {
  return [...scored].sort((a, b) => b.score - a.score).slice(0, limit)
}
