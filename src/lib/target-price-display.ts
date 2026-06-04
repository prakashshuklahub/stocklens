// UI formatting for target price and upside (shared across watchlist, picks, etc.)

import type { Pick, StockFundamentals } from '@/types'

/** Frozen buy reference when the pick was published. */
export function suggestedPickPrice(pick: Pick): number {
  if (pick.suggested_price != null && pick.suggested_price > 0) return pick.suggested_price
  if (pick.entry_high > 0) return pick.entry_high
  return pick.current_price
}

/** % change from suggested publish price to live price. */
export function pickReturnSincePublishPct(pick: Pick): number | null {
  const base = suggestedPickPrice(pick)
  if (base <= 0 || pick.current_price <= 0) return null
  return ((pick.current_price - base) / base) * 100
}

export function formatPickPrice(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatPickSincePct(pct: number): string {
  const sign = pct > 0 ? '+' : pct < 0 ? '' : ''
  return `${sign}${pct.toFixed(1)}%`
}

/** Short label for when the published run completed (US market date). */
export function formatPickPublishedDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'America/New_York',
  }).format(new Date(iso))
}

export const TARGET_UNAVAILABLE = '—'

export function hasTargetPrice(value: number | null | undefined): boolean {
  return value != null && value > 0 && Number.isFinite(value)
}

export function isAnalystTargetSource(source: StockFundamentals['target_source']): boolean {
  return (
    source === 'stockanalysis' ||
    source === 'fmp' ||
    source === 'eulerpool' ||
    source === 'finnhub' ||
    source === 'yahoo'
  )
}

/** UI: analyst target only — 52W cached fallback stays in DB for scoring but shows as unavailable. */
export function hasDisplayTargetPrice(
  price: number | null | undefined,
  source: StockFundamentals['target_source'],
): boolean {
  return hasTargetPrice(price) && isAnalystTargetSource(source)
}

export function formatTargetPrice(value: number | null | undefined): string {
  if (!hasTargetPrice(value)) return TARGET_UNAVAILABLE
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value!)
}

export function formatDisplayTargetPrice(
  price: number | null | undefined,
  source: StockFundamentals['target_source'],
): string {
  if (!hasDisplayTargetPrice(price, source)) return TARGET_UNAVAILABLE
  return formatTargetPrice(price)
}

export function computeTargetUpsidePct(
  targetPrice: number | null | undefined,
  currentPrice: number | null | undefined,
): number | null {
  if (!hasTargetPrice(targetPrice) || currentPrice == null || currentPrice <= 0) return null
  return ((targetPrice! - currentPrice) / currentPrice) * 100
}

export function formatUpsidePct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return TARGET_UNAVAILABLE
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`
}

export function formatDisplayUpsidePct(
  targetPrice: number | null | undefined,
  currentPrice: number | null | undefined,
  source: StockFundamentals['target_source'],
): string {
  if (!hasDisplayTargetPrice(targetPrice, source)) return TARGET_UNAVAILABLE
  return formatUpsidePct(computeTargetUpsidePct(targetPrice, currentPrice))
}

export function formatDisplayUpsideDollar(
  targetPrice: number | null | undefined,
  currentPrice: number | null | undefined,
  source: StockFundamentals['target_source'],
): string {
  if (!hasDisplayTargetPrice(targetPrice, source)) return TARGET_UNAVAILABLE
  return formatUpsideDollar(targetPrice, currentPrice)
}

export function formatUpsideDollar(
  targetPrice: number | null | undefined,
  currentPrice: number | null | undefined,
): string {
  if (!hasTargetPrice(targetPrice) || currentPrice == null) return TARGET_UNAVAILABLE
  const delta = targetPrice! - currentPrice
  const prefix = delta >= 0 ? '+' : '-'
  return `${prefix}$${Math.abs(delta).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

export function targetPriceSubline(source: StockFundamentals['target_source']): string | null {
  if (isAnalystTargetSource(source)) return 'Wall Street average · 12 mo'
  return null
}

export function hasDisplayTargetFromPickLabel(
  price: number | null | undefined,
  label: 'analyst' | '52w_high' | 'momentum',
): boolean {
  return label !== '52w_high' && hasTargetPrice(price)
}
