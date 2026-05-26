// Shared news fetching + sentiment scoring.
// Source: Google News RSS (free, no key needed).
// Used by /api/signals, /api/picks/headlines, and pick narratives.

import {
  companyNameTokens,
  headlineRelevanceScore,
  HEADLINE_RELEVANCE_MIN,
  HEADLINE_RELEVANCE_RELAXED_MIN,
  isGenericMarketRoundup,
} from '@/lib/news-relevance'

const BULLISH_WORDS = [
  'beat', 'beats', 'beating', 'topped', 'topped estimates', 'topped expectations',
  'revenue beat', 'earnings beat', 'profit beat', 'blowout', 'blowout quarter',
  'record revenue', 'record profit', 'record earnings', 'record sales',
  'record high', 'all-time high', 'new high', 'multi-year high', '52-week high',
  'exceeded', 'exceeded expectations', 'exceeded estimates', 'smashed',
  'crushed', 'crushed estimates', 'crushed expectations',
  'guidance raised', 'raised guidance', 'raised outlook', 'raised forecast',
  'raised target', 'price target raised', 'boosted guidance', 'strong outlook',
  'rosy outlook', 'raised full-year', 'raised annual', 'upbeat guidance',
  'surge', 'surges', 'surging', 'soar', 'soars', 'soaring', 'skyrocket',
  'skyrockets', 'rally', 'rallies', 'rallying', 'climb', 'climbs', 'climbing',
  'jump', 'jumps', 'jumping', 'spike', 'spikes', 'spiking', 'pop', 'pops',
  'popping', 'rise', 'rises', 'rising', 'higher', 'upswing', 'uptrend',
  'breakout', 'breaks out', 'broke out', 'momentum', 'bull run', 'bull market',
  'upgrade', 'upgrades', 'upgraded', 'overweight', 'outperform', 'strong buy',
  'buy rating', 'top pick', 'best idea', 'initiates buy', 'initiates with buy',
  'reiterated buy', 'raised to buy', 'double upgrade',
  'acquire', 'acquires', 'acquisition', 'merger', 'buyout', 'take private',
  'partnership', 'strategic deal', 'joint venture', 'license deal',
  'buyback', 'share repurchase', 'dividend increase', 'dividend hike',
  'special dividend', 'stock split', 'spinoff', 'ipo success',
  'growth', 'growing', 'expand', 'expansion', 'expanding', 'scale',
  'accelerating', 'acceleration', 'market share', 'market leader',
  'dominates', 'dominance', 'outpaces', 'outpacing', 'ahead of schedule',
  'ahead of plan', 'faster than expected',
  'breakthrough', 'innovation', 'innovative', 'launch', 'launches', 'launched',
  'new product', 'product launch', 'unveiled', 'introduces', 'pioneering',
  'revolutionary', 'game-changing', 'disruptive', 'next-generation',
  'profit', 'profits', 'profitable', 'profitability', 'margin expansion',
  'gross margin up', 'operating leverage', 'cash flow positive', 'free cash flow',
  'debt-free', 'strong balance sheet', 'raised', 'raise',
  'bull', 'bullish', 'positive', 'upside', 'boom', 'booming', 'booms',
  'optimistic', 'optimism', 'confidence', 'confident', 'win', 'wins', 'winning',
  'strong', 'strength', 'robust', 'resilient', 'solid', 'exceptional',
  'stellar', 'impressive', 'outstanding', 'remarkable', 'thriving', 'healthy',
  'buy', 'long', 'upside potential', 'massive upside', 'well-positioned',
]

const BEARISH_WORDS = [
  'miss', 'misses', 'missed', 'revenue miss', 'earnings miss', 'profit miss',
  'below expectations', 'below estimates', 'fell short', 'falls short',
  'disappoints', 'disappointing', 'disappointment', 'underwhelming',
  'worse than expected', 'came in below', 'came in light',
  'guidance cut', 'cut guidance', 'lowered guidance', 'lowered outlook',
  'lowered forecast', 'lowered target', 'price target cut', 'slashed guidance',
  'withdrew guidance', 'pulled guidance', 'cautious outlook', 'bleak outlook',
  'warned', 'warning', 'profit warning', 'issues warning', 'caution',
  'fall', 'falls', 'falling', 'drop', 'drops', 'dropping', 'plunge', 'plunges',
  'plunging', 'plummet', 'plummets', 'plummeting', 'decline', 'declines',
  'declining', 'sink', 'sinks', 'sinking', 'slump', 'slumps', 'slumping',
  'tumble', 'tumbles', 'tumbling', 'slide', 'slides', 'sliding', 'crash',
  'crashes', 'crashing', 'collapse', 'collapses', 'collapsing', 'tank',
  'tanks', 'tanking', 'lower', 'downtrend', 'sell-off', 'selloff', 'rout',
  '52-week low', 'new low', 'multi-year low', 'all-time low',
  'downgrade', 'downgrades', 'downgraded', 'underperform', 'underweight',
  'sell rating', 'reduce', 'reduced to sell', 'double downgrade',
  'cut to sell', 'lowered to underperform', 'reiterated sell',
  'lawsuit', 'lawsuits', 'sued', 'sues', 'class action', 'securities fraud',
  'probe', 'probed', 'investigation', 'investigated', 'subpoena', 'subpoenaed',
  'fine', 'fined', 'penalty', 'penalties', 'antitrust', 'regulatory action',
  'sec charges', 'doj charges', 'charged', 'charges', 'indicted', 'indictment',
  'settlement', 'court order', 'restraining order',
  'bankruptcy', 'bankrupt', 'insolvent', 'insolvency', 'default', 'defaulted',
  'debt crisis', 'restructuring', 'chapter 11', 'chapter 7', 'liquidation',
  'going concern', 'rescue deal', 'bailout', 'creditors',
  'layoff', 'layoffs', 'laid off', 'job cuts', 'workforce reduction',
  'headcount reduction', 'retrenchment', 'downsizing', 'restructure',
  'plant closure', 'factory shutdown', 'halt production', 'recall', 'recalls',
  'recession', 'slowdown', 'contraction', 'stagflation', 'inflation surge',
  'rate hike fears', 'rising rates', 'demand weakness', 'weak demand',
  'inventory glut', 'oversupply', 'supply glut', 'pricing pressure',
  'margin compression', 'margin squeeze', 'losing market share',
  'bear', 'bearish', 'negative', 'downside', 'risk', 'risks', 'risky',
  'concern', 'concerns', 'troubling', 'trouble', 'crisis', 'problem',
  'issues', 'struggle', 'struggles', 'struggling', 'headwind', 'headwinds',
  'uncertainty', 'uncertain', 'volatility', 'volatile', 'weak', 'weakness',
  'loss', 'losses', 'losing', 'bleed', 'bleeds', 'bleeding',
  'cut', 'cuts', 'slash', 'slashes', 'slashed', 'delay', 'delayed', 'delays',
  'halt', 'halts', 'halted', 'suspend', 'suspends', 'suspended',
  'abandon', 'abandoned', 'cancels', 'cancelled', 'scrapped',
]

export function scoreSentiment(text: string): number {
  const lower = text.toLowerCase()
  let score = 0
  for (const w of BULLISH_WORDS) if (lower.includes(w)) score += 1
  for (const w of BEARISH_WORDS) if (lower.includes(w)) score -= 1
  return score
}

export interface RawNewsItem {
  ticker: string
  title: string
  url: string
  source: string
  published_at: string
  sentiment_score: number
  sentiment: 'bullish' | 'bearish'
  relevance_score?: number
}

export interface NewsFetchContext {
  companyName?: string | null
}

/** Fetch enough candidates before slicing to HEADLINES_LIMIT in pick-headlines. */
const HEADLINES_FETCH_TARGET = 8

function resolveSentiment(title: string): { sentiment_score: number; sentiment: 'bullish' | 'bearish' } | null {
  const sentiment_score = scoreSentiment(title)
  if (sentiment_score > 0) return { sentiment_score, sentiment: 'bullish' }
  if (sentiment_score < 0) return { sentiment_score, sentiment: 'bearish' }
  return null
}

function parseRSS(
  xml: string,
  ticker: string,
  context: NewsFetchContext = {},
  minRelevance = HEADLINE_RELEVANCE_MIN,
): RawNewsItem[] {
  const items: RawNewsItem[] = []
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g)
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000

  for (const match of itemMatches) {
    const block = match[1]
    const titleMatch = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                       block.match(/<title>(.*?)<\/title>/)
    const linkMatch  = block.match(/<link>(.*?)<\/link>/) ||
                       block.match(/<guid[^>]*>(.*?)<\/guid>/)
    const pubMatch   = block.match(/<pubDate>(.*?)<\/pubDate>/)
    const sourceMatch = block.match(/<source[^>]*>(.*?)<\/source>/)

    const title = titleMatch?.[1]?.trim()
    const url   = linkMatch?.[1]?.trim()
    const pub   = pubMatch?.[1]?.trim()
    const source = sourceMatch?.[1]?.trim() ?? 'News'

    if (!title || !url || !pub) continue

    const pubDate = new Date(pub)
    if (isNaN(pubDate.getTime()) || pubDate.getTime() < sevenDaysAgo) continue

    const relevance = headlineRelevanceScore(title, ticker, context.companyName)
    if (relevance < minRelevance) continue
    if (isGenericMarketRoundup(title) && relevance < HEADLINE_RELEVANCE_MIN) continue

    const tone = resolveSentiment(title)
    if (!tone) continue

    items.push({
      ticker,
      title,
      url,
      source,
      published_at: pubDate.toISOString(),
      sentiment_score: tone.sentiment_score,
      sentiment: tone.sentiment,
      relevance_score: relevance,
    })
  }

  return items
}

function sortNewsItems(items: RawNewsItem[]): RawNewsItem[] {
  return items.sort((a, b) => {
    const rel = (b.relevance_score ?? 0) - (a.relevance_score ?? 0)
    if (rel !== 0) return rel
    const age = new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    if (age !== 0) return age
    return Math.abs(b.sentiment_score) - Math.abs(a.sentiment_score)
  })
}

function dedupeNewsItems(items: RawNewsItem[]): RawNewsItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = item.title.slice(0, 80).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

async function fetchNewsRss(ticker: string, query: string): Promise<string | null> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en&tbs=qdr:w`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    next: { revalidate: 1800 },
  })
  if (!res.ok) return null
  return res.text()
}

function buildNewsQueries(ticker: string, companyName?: string | null): string[] {
  const sym = ticker.toUpperCase()
  const tokens = companyNameTokens(companyName)
  const queries = [`${sym} stock`]

  if (tokens.length >= 2) {
    queries.push(`${tokens[0]} ${tokens[1]} stock`)
  } else if (tokens.length === 1) {
    queries.push(`${tokens[0]} stock`)
  }

  return [...new Set(queries)]
}

export async function fetchNewsForTicker(
  ticker: string,
  context: NewsFetchContext = {},
): Promise<RawNewsItem[]> {
  try {
    const sym = ticker.toUpperCase()
    const queries = buildNewsQueries(sym, context.companyName)
    const merged: RawNewsItem[] = []

    for (const query of queries) {
      const xml = await fetchNewsRss(sym, query)
      if (!xml) continue
      merged.push(...parseRSS(xml, sym, context, HEADLINE_RELEVANCE_MIN))
      if (merged.length >= HEADLINES_FETCH_TARGET) break
    }

    let items = dedupeNewsItems(merged)

    if (items.length < HEADLINES_FETCH_TARGET) {
      for (const query of queries) {
        const xml = await fetchNewsRss(sym, query)
        if (!xml) continue
        items = dedupeNewsItems([
          ...items,
          ...parseRSS(xml, sym, context, HEADLINE_RELEVANCE_RELAXED_MIN),
        ])
        if (items.length >= HEADLINES_FETCH_TARGET) break
      }
    }

    return sortNewsItems(items)
  } catch {
    return []
  }
}
