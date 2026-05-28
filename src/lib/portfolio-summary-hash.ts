import { createHash } from 'crypto'
import type { PortfolioHolding } from '@/types'

/** Stable fingerprint when holdings sync changes (qty / cost / tickers). */
export function hashPortfolioHoldings(holdings: Pick<PortfolioHolding, 'ticker' | 'quantity' | 'avg_cost_basis'>[]): string {
  const parts = [...holdings]
    .sort((a, b) => a.ticker.localeCompare(b.ticker, undefined, { sensitivity: 'base' }))
    .map(
      (h) =>
        `${h.ticker.toUpperCase()}:${h.quantity}:${Number(h.avg_cost_basis).toFixed(4)}`,
    )
  return createHash('sha256').update(parts.join('|')).digest('hex')
}
