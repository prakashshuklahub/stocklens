/** Yahoo assetProfile — cached company description for pick narratives. */

const PROFILE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const profileCache = new Map<string, { summary: string | null; at: number }>()

function firstSentences(text: string, maxChars = 320): string {
  const trimmed = text.replace(/\s+/g, ' ').trim()
  if (trimmed.length <= maxChars) return trimmed

  const slice = trimmed.slice(0, maxChars)
  const lastPeriod = slice.lastIndexOf('. ')
  if (lastPeriod > 120) return `${slice.slice(0, lastPeriod + 1).trim()}`
  return `${slice.trim()}…`
}

export async function fetchYahooBusinessSummary(ticker: string): Promise<string | null> {
  const sym = ticker.toUpperCase()
  const hit = profileCache.get(sym)
  if (hit && Date.now() - hit.at < PROFILE_CACHE_TTL_MS) return hit.summary

  let summary: string | null = null
  try {
    const res = await fetch(
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${sym}?modules=assetProfile`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' },
    )
    if (res.ok) {
      const data = await res.json()
      const raw = data?.quoteSummary?.result?.[0]?.assetProfile?.longBusinessSummary as string | undefined
      if (raw?.trim()) summary = firstSentences(raw.trim())
    }
  } catch {
    /* ignore */
  }

  profileCache.set(sym, { summary, at: Date.now() })
  return summary
}

export function mechanicalCompanyBlurb(
  companyName: string,
  ticker: string,
  sector: string | null | undefined,
): string {
  const sectorLabel = sector && sector !== 'Other' ? sector : 'its industry'
  return `${companyName} (${ticker}) is a ${sectorLabel} company. The signals below show why it ranked among today's top picks.`
}
