import { isTargetCacheFresh } from '@/lib/target-price-cache'
import type { StockFundamentals } from '@/types'

export const FUNDAMENTALS_CACHE_MINUTES = 30

export function fundamentalsCacheCutoff(minutes = FUNDAMENTALS_CACHE_MINUTES): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

export function hasAnalystCoverage(row: StockFundamentals): boolean {
  const total = (row.analyst_buy ?? 0) + (row.analyst_hold ?? 0) + (row.analyst_sell ?? 0)
  return total >= 3
}

export function hasCachedTarget(row: StockFundamentals): boolean {
  return row.target_price != null && row.target_price > 0
}

/** Target cache expired (resets daily at 5pm ET). */
export function needsTargetRefresh(row: StockFundamentals): boolean {
  return !isTargetCacheFresh(row.target_fetched_at)
}

export function isFundamentalsCacheFresh(
  row: StockFundamentals & { fetched_at?: string | null },
  cutoffIso: string,
): boolean {
  return Boolean(row.fetched_at && row.fetched_at >= cutoffIso)
}
