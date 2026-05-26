/** Score how tightly a Google News title matches a specific ticker/company. */

const GENERIC_MARKET_PATTERNS = [
  /\bstock market\b/i,
  /\bwall street\b/i,
  /\bdow jones\b/i,
  /\bs&p 500\b/i,
  /\bnasdaq composite\b/i,
  /\bstocks to (watch|buy|sell)\b/i,
  /\btop stocks\b/i,
  /\bmarket wrap\b/i,
  /\bsector (rally|selloff|rotation)\b/i,
]

const COMPANY_STOPWORDS = new Set([
  'inc',
  'corp',
  'corporation',
  'ltd',
  'limited',
  'plc',
  'co',
  'company',
  'holdings',
  'group',
  'the',
  'and',
  'class',
])

export function companyNameTokens(companyName: string | null | undefined): string[] {
  if (!companyName?.trim()) return []
  return companyName
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !COMPANY_STOPWORDS.has(t))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function tickerMentioned(title: string, ticker: string): boolean {
  const sym = ticker.toUpperCase()
  const escaped = escapeRegExp(sym)
  return (
    new RegExp(`\\b${escaped}\\b`, 'i').test(title) ||
    new RegExp(`\\(${escaped}\\)`, 'i').test(title) ||
    new RegExp(`\\$${escaped}\\b`, 'i').test(title) ||
    new RegExp(`\\b${escaped}:`, 'i').test(title)
  )
}

export function headlineRelevanceScore(
  title: string,
  ticker: string,
  companyName?: string | null,
): number {
  const lower = title.toLowerCase()
  const sym = ticker.toUpperCase()
  let score = 0

  if (tickerMentioned(title, sym)) score += 12

  const tokens = companyNameTokens(companyName)
  let tokenHits = 0
  for (const token of tokens) {
    if (lower.includes(token)) tokenHits++
  }
  if (tokenHits >= 2) score += 10
  else if (tokenHits === 1) score += 7

  const hasEntityMatch = score > 0

  for (const pattern of GENERIC_MARKET_PATTERNS) {
    if (pattern.test(title)) score -= 4
  }

  // RSS is already scoped to this ticker — soft baseline when Google omits the symbol.
  if (!hasEntityMatch && score <= 0) score = 2

  return Math.max(score, 0)
}

/** Preferred minimum relevance (strict pass). */
export const HEADLINE_RELEVANCE_MIN = 3

/** Relaxed floor when strict pass returns too few headlines. */
export const HEADLINE_RELEVANCE_RELAXED_MIN = 1

export function isGenericMarketRoundup(title: string): boolean {
  let hits = 0
  for (const pattern of GENERIC_MARKET_PATTERNS) {
    if (pattern.test(title)) hits++
  }
  return hits >= 2
}
