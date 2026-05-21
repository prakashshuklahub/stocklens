// Eulerpool — analyst price target consensus (free tier: 1,000 requests/month).
// https://eulerpool.com/developers/api/equity/price/target

import { env } from '@/lib/env'
import type { PriceTargetFields } from '@/lib/yahoo-session'

const EULERPOOL_BASE = 'https://api.eulerpool.com/api/1'

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function parseEulerpoolTarget(data: Record<string, unknown>): PriceTargetFields | null {
  const target_mean =
    positiveNumber(data.target_mean) ??
    positiveNumber(data.target_median) ??
    positiveNumber(data.targetMean) ??
    positiveNumber(data.targetMedian) ??
    positiveNumber(data.mean) ??
    positiveNumber(data.median) ??
    positiveNumber(data.consensus)

  if (target_mean == null) return null

  return {
    target_mean,
    target_high:
      positiveNumber(data.target_high) ??
      positiveNumber(data.targetHigh) ??
      positiveNumber(data.high) ??
      positiveNumber(data.max) ??
      null,
    target_low:
      positiveNumber(data.target_low) ??
      positiveNumber(data.targetLow) ??
      positiveNumber(data.low) ??
      positiveNumber(data.min) ??
      null,
  }
}

async function eulerpoolGet(path: string): Promise<{ ok: boolean; status: number; data: unknown }> {
  const token = env.EULERPOOL_API_KEY
  if (!token) return { ok: false, status: 0, data: null }

  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${EULERPOOL_BASE}${path}${sep}token=${encodeURIComponent(token)}`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }

  return { ok: res.ok, status: res.status, data }
}

async function resolveEulerpoolIdentifier(ticker: string): Promise<string[]> {
  const sym = ticker.toUpperCase()
  const ids = new Set<string>([sym])

  const profile = await eulerpoolGet(`/equity/profile/${encodeURIComponent(sym)}`)
  if (profile.ok && profile.data && typeof profile.data === 'object') {
    const isin = (profile.data as Record<string, unknown>).isin
    if (typeof isin === 'string' && isin.length >= 10) ids.add(isin)
  }

  return [...ids]
}

async function fetchEulerpoolTargetForId(identifier: string): Promise<PriceTargetFields | null> {
  const result = await eulerpoolGet(`/equity/price-target/${encodeURIComponent(identifier)}`)
  if (!result.ok) return null

  const row = Array.isArray(result.data) ? result.data[0] : result.data
  if (!row || typeof row !== 'object') return null
  return parseEulerpoolTarget(row as Record<string, unknown>)
}

export async function fetchEulerpoolPriceTarget(ticker: string): Promise<PriceTargetFields | null> {
  if (!env.EULERPOOL_API_KEY) return null

  const sym = ticker.toUpperCase()
  try {
    const identifiers = await resolveEulerpoolIdentifier(sym)

    for (const id of identifiers) {
      const parsed = await fetchEulerpoolTargetForId(id)
      if (parsed?.target_mean) return parsed
    }

    console.warn(`[price-target] ${sym}: eulerpool empty`)
    return null
  } catch (err) {
    console.warn(`[price-target] ${sym}: eulerpool error`, err instanceof Error ? err.message : err)
    return null
  }
}
