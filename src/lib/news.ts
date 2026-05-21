// Shared news fetching + sentiment scoring.
// Source: Google News RSS (free, no key needed).
// Used by /api/news and /api/signals.

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
}

function parseRSS(xml: string, ticker: string): RawNewsItem[] {
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

    const score = scoreSentiment(title)
    if (score === 0) continue

    items.push({
      ticker,
      title,
      url,
      source,
      published_at: pubDate.toISOString(),
      sentiment_score: score,
      sentiment: score > 0 ? 'bullish' : 'bearish',
    })
  }

  return items
}

export async function fetchNewsForTicker(ticker: string): Promise<RawNewsItem[]> {
  try {
    const q = encodeURIComponent(`${ticker} stock`)
    const url = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en&tbs=qdr:w`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      next: { revalidate: 1800 },
    })
    if (!res.ok) return []
    const xml = await res.text()
    return parseRSS(xml, ticker)
  } catch {
    return []
  }
}
