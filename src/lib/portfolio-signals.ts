import { isLLMEnabled } from '@/lib/llm'
import { mechanicalProfitReview, mechanicalSignalReview } from '@/lib/portfolio-alerts'
import { scoreHoldingSignal, sortBySignalTier, type HoldingSignalScore } from '@/lib/portfolio-alert-scoring'
import type {
  HoldingSignal,
  PortfolioHolding,
  PortfolioHoldingWithSignal,
  PortfolioSignalsMeta,
  StockFundamentals,
  StockSnapshot,
} from '@/types'

export function buildHoldingSignal(
  holding: PortfolioHolding,
  scored: HoldingSignalScore,
  currentPrice: number,
): Omit<HoldingSignal, 'narrative_source'> & { narrative_source: 'mechanical' } {
  if (scored.tier === 'quiet') {
    return {
      tier: 'quiet',
      headline: '',
      factors: [],
      review_reason: null,
      caveat: null,
      narrative_source: 'mechanical',
    }
  }

  if (scored.tier === 'profit') {
    const narrative = mechanicalProfitReview({
      ticker: holding.ticker,
      quantity: holding.quantity,
      avg_cost_basis: holding.avg_cost_basis,
      current_price: currentPrice,
      position_pnl_pct: scored.position_pnl_pct,
      factors: scored.factors,
    })
    return {
      tier: 'profit',
      headline: scored.headline,
      factors: scored.factors,
      review_reason: narrative.review_reason,
      caveat: narrative.caveat,
      narrative_source: 'mechanical',
    }
  }

  const narrative = mechanicalSignalReview(scored.bearish!, scored.tier)
  return {
    tier: scored.tier,
    score: scored.score,
    headline: scored.headline,
    factors: scored.factors,
    review_reason: narrative.review_reason,
    caveat: narrative.caveat,
    narrative_source: 'mechanical',
  }
}

export function attachSignalsToHoldings(
  holdings: PortfolioHolding[],
  priceMap: Map<string, StockSnapshot>,
  fundamentalsByTicker: Map<string, StockFundamentals>,
): PortfolioHoldingWithSignal[] {
  const enriched: PortfolioHoldingWithSignal[] = []

  for (const holding of holdings) {
    const snapshot = priceMap.get(holding.ticker.toUpperCase()) ?? null
    const price = snapshot?.price ?? null
    const scored = scoreHoldingSignal({
      holding,
      current_price: price ?? 0,
      fundamentals: fundamentalsByTicker.get(holding.ticker.toUpperCase()) ?? null,
    })
    const signal = buildHoldingSignal(holding, scored, price ?? 0)

    enriched.push({
      ...holding,
      snapshot,
      signal,
    })
  }

  return sortBySignalTier(enriched)
}

export function buildSignalsMeta(holdings: PortfolioHoldingWithSignal[]): PortfolioSignalsMeta {
  const byTier = { soft: 0, attention: 0, profit: 0 }
  for (const h of holdings) {
    if (h.signal.tier === 'soft') byTier.soft++
    else if (h.signal.tier === 'attention') byTier.attention++
    else if (h.signal.tier === 'profit') byTier.profit++
  }

  return {
    by_tier: byTier,
    quiet_count: holdings.length - byTier.soft - byTier.attention - byTier.profit,
    holding_count: holdings.length,
    llm_enabled: isLLMEnabled(),
    generated_at: new Date().toISOString(),
  }
}

/** Merge live price snapshots into a signals response without rescoring. */
export function mergePriceSnapshots(
  current: PortfolioHoldingWithSignal[],
  priceRows: Array<{ ticker: string; snapshot: StockSnapshot | null }>,
): PortfolioHoldingWithSignal[] {
  const priceByTicker = new Map(priceRows.map((r) => [r.ticker.toUpperCase(), r.snapshot]))
  return current.map((h) => {
    const snapshot = priceByTicker.get(h.ticker.toUpperCase())
    return snapshot !== undefined ? { ...h, snapshot } : h
  })
}
