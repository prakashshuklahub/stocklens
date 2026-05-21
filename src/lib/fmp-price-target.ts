// Financial Modeling Prep — analyst price target consensus (free tier: 250 calls/day).
// https://site.financialmodelingprep.com/developer/docs/stable/price-target-consensus

import { env } from '@/lib/env'
import type { PriceTargetFields } from '@/lib/yahoo-session'

const FMP_BASE = 'https://financialmodelingprep.com/stable/price-target-consensus'

function parseFmpRow(row: Record<string, unknown>): PriceTargetFields | null {
  const target_mean =
    (typeof row.targetConsensus === 'number' ? row.targetConsensus : null) ??
    (typeof row.targetMedian === 'number' ? row.targetMedian : null)
  if (target_mean == null || target_mean <= 0) return null
  return {
    target_mean,
    target_high: typeof row.targetHigh === 'number' ? row.targetHigh : null,
    target_low: typeof row.targetLow === 'number' ? row.targetLow : null,
  }
}

export async function fetchFmpPriceTarget(ticker: string): Promise<PriceTargetFields | null> {
  if (!env.FMP_API_KEY) return null

  const sym = ticker.toUpperCase()
  try {
    const url = `${FMP_BASE}?symbol=${encodeURIComponent(sym)}&apikey=${encodeURIComponent(env.FMP_API_KEY)}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      console.warn(`[price-target] ${sym}: fmp http=${res.status}`)
      return null
    }
    const data: unknown = await res.json()
    const row = Array.isArray(data) ? data[0] : data
    if (!row || typeof row !== 'object') {
      console.warn(`[price-target] ${sym}: fmp empty`)
      return null
    }
    const parsed = parseFmpRow(row as Record<string, unknown>)
    if (!parsed) {
      console.warn(`[price-target] ${sym}: fmp no consensus`)
      return null
    }
    return parsed
  } catch (err) {
    console.warn(`[price-target] ${sym}: fmp error`, err instanceof Error ? err.message : err)
    return null
  }
}
