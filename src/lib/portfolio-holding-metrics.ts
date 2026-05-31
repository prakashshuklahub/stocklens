import type { PortfolioHoldingWithPrice, PortfolioHoldingWithSignal } from '@/types'

export function fmtHolding(n: number, decimals = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function dayChangePerShare(price: number, change1dPct: number): number {
  const prev = price / (1 + change1dPct / 100)
  return price - prev
}

export type HoldingMetrics = {
  price: number | null
  change1d: number | null
  currentValue: number | null
  invested: number
  pnl: number | null
  pnlPct: number | null
  isPos: boolean | null
  dayPnl: number | null
}

export function computeHoldingMetrics(h: PortfolioHoldingWithPrice): HoldingMetrics {
  const price = h.snapshot?.price ?? null
  const change1d = h.snapshot?.change_1d_pct ?? null
  const currentValue = price != null ? price * h.quantity : null
  const invested = h.avg_cost_basis * h.quantity
  const pnl = currentValue != null ? currentValue - invested : null
  const pnlPct = invested && pnl != null ? (pnl / invested) * 100 : null
  const isPos = pnl != null ? pnl >= 0 : null
  const dayPnl =
    price != null && change1d != null ? dayChangePerShare(price, change1d) * h.quantity : null

  return { price, change1d, currentValue, invested, pnl, pnlPct, isPos, dayPnl }
}

export function formatShareQty(qty: number): string {
  return qty % 1 === 0 ? fmtHolding(qty, 0) : fmtHolding(qty, 4)
}

/** Sum of live market values across holdings (skips rows without price). */
export function computePortfolioTotalValue(holdings: PortfolioHoldingWithPrice[]): number {
  let total = 0
  for (const h of holdings) {
    const price = h.snapshot?.price
    if (price != null) total += price * h.quantity
  }
  return total
}

export function holdingWeightPct(
  h: PortfolioHoldingWithPrice,
  totalValue: number,
): number | null {
  const price = h.snapshot?.price
  if (price == null || totalValue <= 0) return null
  return (price * h.quantity / totalValue) * 100
}
