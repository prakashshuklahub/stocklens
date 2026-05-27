// Trending card blurbs (mechanical + Gemini context).
// Scoring rules: @/lib/watchlist-suggestions-scoring

import { fetchYahooBusinessSummary } from '@/lib/company-profile'
import { formatUpsidePct } from '@/lib/target-price-display'
import type { TrendingNarrative } from '@/types'
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
export type { TrendingNarrative } from '@/types'
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

export interface SuggestionBlurbExtras {
  company_blurb: string | null
  top_headline: string | null
}

const GENERIC_BLURB_PATTERNS = [
  /this stock is on the/i,
  /day[- ]gainers list/i,
  /most-active list/i,
  /shows a strong multi-week uptrend/i,
  /multi-week uptrend/i,
  /surfaced on today/i,
  /surfaced as a day gainer/i,
  /hot name on/i,
  /worth tracking/i,
  /analysts rate buy/i,
  /investors react to news:/i,
  / is driving attention today/i,
  /is a publicly traded company/i,
  /\bis an? [a-z][a-z\s]{0,24} company\b/i,
  /\b(industrial|technology|healthcare|energy|financial|tech)\s+stock\b/i,
  /\bstrong buy\b/i,
  /\bday gainer\b/i,
  /\bmost active\b/i,
  /hot momentum/i,
]

function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?])\s+/).filter((part) => part.trim().length > 8).length
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function firstBlurbSentence(text: string, maxLen = 170): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (!trimmed) return ''
  const first = trimmed.split(/(?<=[.!?])\s+/)[0]?.trim() ?? trimmed
  const clipped = first.length <= maxLen ? first : `${first.slice(0, maxLen - 1).trim()}…`
  return clipped.replace(/\.$/, '')
}

function companyShortName(companyName: string): string {
  return companyName.split(',')[0]?.trim() ?? companyName
}

function companyHeadlinePrefix(companyName: string): string {
  const short = companyShortName(companyName)
  const firstWord = short.split(/\s+/)[0] ?? short
  return firstWord.length >= 3 ? firstWord : short
}

function cleanHeadlineText(headline: string, companyName: string, ticker: string): string {
  let h = headline.trim()
  h = h.replace(new RegExp(`\\(${escapeRegExp(ticker)}\\)`, 'gi'), '')
  h = h.replace(new RegExp(`\\b${escapeRegExp(ticker)}\\b`, 'gi'), '')
  const shortName = companyShortName(companyName)
  const namePrefix = companyHeadlinePrefix(companyName)
  for (const prefix of [shortName, namePrefix]) {
    if (!prefix) continue
    h = h.replace(new RegExp(`^${escapeRegExp(prefix)}\\b`, 'i'), '')
  }
  h = h.replace(/\bstock\b/gi, '')
  h = h.replace(/\s+/g, ' ').trim()
  const parts = h.split(/\s[-–—|]\s/)
  h = parts[0]?.trim() || h
  return h.replace(/^[\s:,-]+/, '').trim()
}

function looksLikeHeadlineSentence(text: string): boolean {
  return /\b(continues|continued|remains|surges|surged|jumps|jumped|falls|fell|extends|extended|accelerates|climbs|climbed|slides|soars|soared|tumbles|rallies|rallying|gains|gained|drops|dropped|rebounds|rebounded)\b/i.test(
    text,
  )
}

function headlineCatalyst(s: ScoredSuggestion, headline: string): string {
  const cleaned = cleanHeadlineText(headline, s.company_name, s.ticker)
  const lower = cleaned.toLowerCase()

  if (/analyst upgrade|upgraded to|price target/i.test(lower)) {
    return 'Fresh analyst upgrades are driving new buying interest'
  }
  if (/earnings|eps|revenue beat|revenue miss/i.test(lower)) {
    return 'Earnings results are reshaping how investors value the business'
  }
  if (/\bfda\b|clinical trial|drug approval/i.test(lower)) {
    return 'Regulatory or clinical news is moving the stock'
  }
  if (/contract|partnership|deal signed|awarded/i.test(lower)) {
    return 'A new contract or partnership headline is lifting sentiment'
  }
  if (/guidance|outlook|forecast/i.test(lower)) {
    return 'Updated guidance is changing investor expectations'
  }
  if (/merger|acquisition|buyout|takeover/i.test(lower)) {
    return 'M&A headlines are pulling in traders'
  }
  if (/layoff|restructur/i.test(lower)) {
    return 'Corporate restructuring news is in focus'
  }
  if (/rally continues|continues to rally|extended rally|ongoing rally|rally extends/i.test(lower)) {
    return 'The rally is extending as momentum traders stay active'
  }
  if (/trading activity|heavy volume|elevated volume|unusual volume|high volume/i.test(lower)) {
    return 'Heavy trading volume is keeping the move going'
  }
  if (/\bsurge\b|\bsoars?\b|\bjumps?\b|\brally\b|\bgains momentum\b|\brip higher\b/i.test(lower)) {
    return 'A sharp price move is drawing fresh momentum interest'
  }
  if (/52-week high|all-time high|record high/i.test(lower)) {
    return 'New high-water marks are attracting breakout traders'
  }
  if (/short squeeze|meme|retail/i.test(lower)) {
    return 'Retail-driven momentum is amplifying the move'
  }

  if (looksLikeHeadlineSentence(cleaned) || cleaned.length > 55) {
    if (/rally|momentum|gain|surge|volume/i.test(lower)) {
      return 'Strong momentum and active trading are keeping the story in focus'
    }
    return 'Fresh headlines are adding fuel to an already active session'
  }

  if (cleaned.length >= 12) {
    const theme = cleaned.charAt(0).toLowerCase() + cleaned.slice(1)
    return `Investors are focused on ${theme}`
  }

  return s.source === 'gainers'
    ? 'A sharp rally on heavy volume is drawing momentum traders'
    : 'Heavy trading volume is putting this name on radars today'
}

/** True when the blurb repeats card stats, is generic, or missing business context. */
export function isRedundantBlurb(
  s: ScoredSuggestion,
  reason: string,
  extras?: SuggestionBlurbExtras,
): boolean {
  return isRedundantNarrative(s, narrativeFromLegacyReason(reason), extras)
}

export function isRedundantNarrative(
  s: ScoredSuggestion,
  narrative: TrendingNarrative,
  extras?: SuggestionBlurbExtras,
): boolean {
  const combined = `${narrative.company_blurb} ${narrative.thesis} ${narrative.main_risk}`
  const r = combined.toLowerCase()
  if (r.includes(s.ticker.toLowerCase())) return true
  if (/\d+\s*\/\s*\d+/.test(combined)) return true
  if (/\d+\s+of\s+\d+\s+analyst/i.test(combined)) return true
  if (/[+\-]?\d+(\.\d+)?%\s*(today|over\s+30)/i.test(combined)) return true
  if (GENERIC_BLURB_PATTERNS.some((p) => p.test(combined))) return true
  if (s.sector && s.sector !== 'Other') {
    const sector = s.sector.toLowerCase()
    if (r.includes(`${sector} company`) || r.includes(`is a ${sector}`) || r.includes(`${sector} stock`)) {
      return true
    }
  }
  if (!narrative.thesis.trim() || narrative.thesis.length < 40) return true
  if (!narrative.main_risk.trim() || narrative.main_risk.length < 25) return true
  if (!narrative.company_blurb.trim()) return true
  if (sentenceCount(narrative.thesis) < 2) return true
  if (extras?.company_blurb && !looksLikeBusinessContext(narrative.company_blurb)) return true
  return false
}

function narrativeFromLegacyReason(reason: string): TrendingNarrative {
  const parts = reason.split(/(?<=[.!?])\s+/).filter((p) => p.trim())
  if (parts.length >= 2) {
    return {
      company_blurb: parts[0]?.trim() ?? '',
      thesis: parts.slice(1, -1).join(' ').trim() || parts[1]?.trim() || '',
      main_risk: parts[parts.length - 1]?.trim() ?? '',
    }
  }
  return {
    company_blurb: '',
    thesis: reason.trim(),
    main_risk: 'Trending names can reverse quickly after a hot session.',
  }
}

/** First sentence should describe products/services, not momentum or ratings. */
function looksLikeBusinessContext(reason: string): boolean {
  const first = reason.split(/(?<=[.!?])\s+/)[0]?.toLowerCase() ?? reason.toLowerCase()
  if (GENERIC_BLURB_PATTERNS.some((p) => p.test(first))) return false
  if (/\b(momentum|gainer|volume|analyst|upgrade|trading|rally|surge)\b/.test(first)) return false
  return first.length >= 25
}

export function monthTrendPhrase(d30: number | null): string | null {
  if (d30 == null) return null
  if (d30 >= 20) return 'a strong multi-week uptrend'
  if (d30 >= 8) return 'positive momentum over the past month'
  if (d30 >= 0) return 'a steady month'
  return 'a recent pullback'
}

export function newsTonePhrase(sentiment: number | null): string | null {
  if (sentiment == null) return null
  if (sentiment > 0.35) return 'recent headlines skew positive'
  if (sentiment < -0.2) return 'recent headlines have been cautious'
  return null
}

export function analystConsensusLabel(s: ScoredSuggestion): 'strong buy' | 'buy' | 'mixed' {
  const ratio = s.analyst_buy / s.analyst_total
  if (ratio >= 0.8 && s.analyst_total >= 6 && (s.analyst_sell ?? 0) === 0) return 'strong buy'
  if (ratio >= 0.55) return 'buy'
  return 'mixed'
}

function whatCompanyDoes(s: ScoredSuggestion, extras?: SuggestionBlurbExtras): string | null {
  if (extras?.company_blurb?.trim()) {
    return firstBlurbSentence(extras.company_blurb)
  }
  return null
}

function whyTrendingToday(s: ScoredSuggestion, extras?: SuggestionBlurbExtras): string {
  if (extras?.top_headline?.trim()) {
    return headlineCatalyst(s, extras.top_headline.trim()) + '.'
  }

  const lead =
    s.source === 'gainers'
      ? 'The stock is among today\'s biggest gainers on heavy volume'
      : 'Unusually high trading volume is drawing attention'

  const tail: string[] = []
  const month = monthTrendPhrase(s.change_30d_pct)
  if (month && s.change_30d_pct != null && s.change_30d_pct >= 8) {
    tail.push(`after ${month}`)
  }
  const news = newsTonePhrase(s.news_sentiment)
  if (news) tail.push(news)

  if (s.near_52w_high) {
    tail.push('while pressing toward its 52-week high')
  }

  if (!tail.length) return `${lead}.`
  return `${lead} ${tail.join(', ')}.`
}

export function mechanicalTrendingNarrative(
  s: ScoredSuggestion,
  extras?: SuggestionBlurbExtras,
): TrendingNarrative {
  const company_blurb =
    whatCompanyDoes(s, extras) ??
    `${companyShortName(s.company_name)} develops products and services in its core market.`

  const signalParts: string[] = []

  if (Math.abs(s.change_1d_pct) >= 3) {
    signalParts.push(
      s.change_1d_pct >= 8
        ? 'Big move today.'
        : `A ${s.change_1d_pct >= 0 ? 'positive' : 'negative'} day with active trading.`,
    )
  }

  if (s.upside_pct != null && Number.isFinite(s.upside_pct)) {
    signalParts.push(`Room to grow ${formatUpsidePct(s.upside_pct)}.`)
  }

  if (s.near_52w_high) {
    signalParts.push('The stock is pressing toward its 52-week high.')
  }

  if (s.change_30d_pct != null && Math.abs(s.change_30d_pct) >= 8) {
    signalParts.push(
      `The stock is ${s.change_30d_pct >= 0 ? 'up' : 'down'} ${Math.abs(s.change_30d_pct).toFixed(1)}% over the past month.`,
    )
  }

  const catalyst = whyTrendingToday(s, extras).replace(/\.$/, '')
  if (catalyst) {
    signalParts.push(`${catalyst.charAt(0).toUpperCase()}${catalyst.slice(1)}.`)
  }

  if (s.analyst_total >= 5) {
    const targetPrice =
      s.upside_pct != null && s.current_price > 0
        ? s.current_price * (1 + s.upside_pct / 100)
        : null
    const targetNote = targetPrice
      ? `an average analyst target of $${targetPrice.toFixed(2)}`
      : 'solid analyst buy support'
    signalParts.push(
      `${s.analyst_buy} of ${s.analyst_total} analysts rate buy, with ${targetNote}.`,
    )
  }

  const thesis =
    signalParts.join(' ') ||
    'Heavy trading volume is putting this name on traders\' radars today.'

  const main_risk =
    s.near_52w_high && s.change_1d_pct > 10
      ? 'Sharp one-day moves can reverse quickly after an extended run. Momentum is not a guarantee of future gains.'
      : 'Trending stocks can cool off as fast as they heat up. Treat big daily moves as volatility, not certainty.'

  return { company_blurb, thesis, main_risk }
}

/** @deprecated Use mechanicalTrendingNarrative — flat string for legacy cache only. */
export function mechanicalReason(
  s: ScoredSuggestion,
  extras?: SuggestionBlurbExtras,
): string {
  const n = mechanicalTrendingNarrative(s, extras)
  return `${n.company_blurb} ${n.thesis} ${n.main_risk}`
}

export function suggestionNarrativeContext(
  s: ScoredSuggestion,
  extras?: SuggestionBlurbExtras,
) {
  const targetPrice =
    s.upside_pct != null && s.current_price > 0
      ? s.current_price * (1 + s.upside_pct / 100)
      : null

  return {
    ticker: s.ticker,
    company_name: s.company_name,
    company_blurb: extras?.company_blurb ?? null,
    top_headline: extras?.top_headline ?? null,
    analyst_consensus: analystConsensusLabel(s),
    mover_screen: (s.source === 'gainers' ? 'day gainers' : 'most active') as 'day gainers' | 'most active',
    sector: s.sector,
    month_trend: monthTrendPhrase(s.change_30d_pct),
    news_tone: newsTonePhrase(s.news_sentiment),
    near_52w_high: s.near_52w_high,
    change_1d_pct: s.change_1d_pct,
    change_30d_pct: s.change_30d_pct,
    upside_pct: s.upside_pct,
    analyst_buy: s.analyst_buy,
    analyst_hold: s.analyst_hold,
    analyst_sell: s.analyst_sell,
    analyst_total: s.analyst_total,
    card_headline: s.headline,
    target_price: targetPrice,
  }
}

/** @deprecated Use suggestionNarrativeContext */
export function suggestionBlurbContext(
  s: ScoredSuggestion,
  extras?: SuggestionBlurbExtras,
) {
  return suggestionNarrativeContext(s, extras)
}

export async function loadSuggestionBlurbExtras(
  targets: ScoredSuggestion[],
): Promise<Map<string, SuggestionBlurbExtras>> {
  const out = new Map<string, SuggestionBlurbExtras>()
  if (!targets.length) return out

  const { fetchHeadlinesForTickers } = await import('@/lib/pick-headlines')
  const companyNameByTicker = Object.fromEntries(
    targets.map((t) => [t.ticker.toUpperCase(), t.company_name]),
  )

  const [headlinesMap, ...summaries] = await Promise.all([
    fetchHeadlinesForTickers(targets.map((t) => t.ticker), {
      limit: 1,
      companyNameByTicker,
    }),
    ...targets.map((t) => fetchYahooBusinessSummary(t.ticker)),
  ])

  targets.forEach((t, i) => {
    const key = t.ticker.toUpperCase()
    out.set(key, {
      company_blurb: summaries[i] ?? null,
      top_headline: headlinesMap.get(key)?.[0]?.title ?? null,
    })
  })

  return out
}
