import type { StockFundamentals } from '@/types'

export const FUNDAMENTALS_CACHE_MINUTES = 30

export function fundamentalsCacheCutoff(minutes = FUNDAMENTALS_CACHE_MINUTES): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString()
}

export function hasAnalystCoverage(row: StockFundamentals): boolean {
  const total = (row.analyst_buy ?? 0) + (row.analyst_hold ?? 0) + (row.analyst_sell ?? 0)
  return total >= 3
}

export function hasAnalystTarget(row: StockFundamentals): boolean {
  return row.target_mean != null && row.target_mean > 0
}

/** Cached row is missing Yahoo/Finnhub targets we expect for rated stocks. */
export function needsTargetRefresh(row: StockFundamentals): boolean {
  return hasAnalystCoverage(row) && !hasAnalystTarget(row)
}

export function isFundamentalsCacheFresh(
  row: StockFundamentals & { fetched_at?: string | null },
  cutoffIso: string,
): boolean {
  return Boolean(row.fetched_at && row.fetched_at >= cutoffIso)
}
