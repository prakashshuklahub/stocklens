// Target price cache: valid until the next 5pm ET reset (shared global data in stock_fundamentals).

import { US_MARKET_TZ } from '@/lib/market-hours'
import type { StockFundamentals } from '@/types'
import type { PriceTargetFields } from '@/lib/yahoo-session'

export const TARGET_CACHE_RESET_HOUR_ET = 17 // 5:00 PM Eastern

export type TargetSource = 'fmp' | 'finnhub' | 'yahoo' | '52w_high'

export type TargetFetchResult = PriceTargetFields & { source: Exclude<TargetSource, '52w_high'> }

type EasternParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

export function getEasternParts(now: Date): EasternParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: US_MARKET_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(now)

  return {
    year: Number(parts.find((p) => p.type === 'year')?.value ?? 0),
    month: Number(parts.find((p) => p.type === 'month')?.value ?? 0),
    day: Number(parts.find((p) => p.type === 'day')?.value ?? 0),
    hour: Number(parts.find((p) => p.type === 'hour')?.value ?? 0),
    minute: Number(parts.find((p) => p.type === 'minute')?.value ?? 0),
  }
}

/** UTC instant for a given Eastern local date/time (handles DST). */
export function easternInstantToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const dayStartUtc = Date.UTC(year, month - 1, day, 0, 0, 0)
  for (let offsetMin = 0; offsetMin < 48 * 60; offsetMin++) {
    const candidate = new Date(dayStartUtc + offsetMin * 60_000)
    const p = getEasternParts(candidate)
    if (p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute) {
      return candidate
    }
  }
  throw new Error(`Could not resolve ${year}-${month}-${day} ${hour}:${minute} ET`)
}

function previousEasternDay(year: number, month: number, day: number): EasternParts {
  const noon = easternInstantToUtc(year, month, day, 12, 0)
  return getEasternParts(new Date(noon.getTime() - 86_400_000))
}

/** Most recent 5pm ET — target cache is fresh if target_fetched_at >= this. */
export function targetCacheCutoffIso(now = new Date()): string {
  const p = getEasternParts(now)
  const nowMins = p.hour * 60 + p.minute
  const resetMins = TARGET_CACHE_RESET_HOUR_ET * 60

  if (nowMins >= resetMins) {
    return easternInstantToUtc(p.year, p.month, p.day, TARGET_CACHE_RESET_HOUR_ET, 0).toISOString()
  }

  const prev = previousEasternDay(p.year, p.month, p.day)
  return easternInstantToUtc(prev.year, prev.month, prev.day, TARGET_CACHE_RESET_HOUR_ET, 0).toISOString()
}

export function isTargetCacheFresh(
  targetFetchedAt: string | null | undefined,
  now = new Date(),
): boolean {
  if (!targetFetchedAt) return false
  return targetFetchedAt >= targetCacheCutoffIso(now)
}

export function isAnalystTargetSource(source: TargetSource | null | undefined): boolean {
  return source === 'fmp' || source === 'finnhub' || source === 'yahoo'
}

/** Merge analyst fetch + 52W override into stock_fundamentals target fields. */
export function applyResolvedTarget(
  row: StockFundamentals,
  analyst: TargetFetchResult | null,
  fetchedAt: string,
): StockFundamentals {
  if (analyst?.target_mean && analyst.target_mean > 0) {
    return {
      ...row,
      target_mean: analyst.target_mean,
      target_high: analyst.target_high,
      target_low: analyst.target_low,
      target_price: analyst.target_mean,
      target_source: analyst.source,
      target_fetched_at: fetchedAt,
    }
  }

  if (row.week52_high != null && row.week52_high > 0) {
    return {
      ...row,
      target_mean: null,
      target_high: null,
      target_low: null,
      target_price: row.week52_high,
      target_source: '52w_high',
      target_fetched_at: fetchedAt,
    }
  }

  return {
    ...row,
    target_mean: null,
    target_high: null,
    target_low: null,
    target_price: null,
    target_source: null,
    target_fetched_at: fetchedAt,
  }
}

export function targetUpsidePct(targetPrice: number, currentPrice: number): number {
  if (currentPrice <= 0) return 0
  return ((targetPrice - currentPrice) / currentPrice) * 100
}
