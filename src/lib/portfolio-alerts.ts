// Portfolio review narratives + demo data.
// Scoring rules live in @/lib/portfolio-alert-scoring.

import type { PickFactor, PortfolioAlert, StockFundamentals } from '@/types'
import type { SellReviewInput } from '@/lib/llm'
import { ALERT_HEADLINES, type ScoredAlert } from '@/lib/portfolio-alert-scoring'

export type { AlertScoreInput, ScoredAlert } from '@/lib/portfolio-alert-scoring'
export {
  scorePortfolioAlert,
  rankAlerts,
  ALERT_RULES,
  ALERT_HEADLINES,
  MIN_BEARISH_FACTORS,
  WATCH_SCORE_THRESHOLD,
  RED_SCORE_THRESHOLD,
} from '@/lib/portfolio-alert-scoring'

const DEFAULT_CAVEAT =
  'This is a data check to help you think—not a command to sell. Take your time and decide what fits your plan.'

function factorLine(f: { label: string; value?: string }): string {
  return f.value ? `${f.label} (${f.value})` : f.label
}

export function buildSellReviewInput(
  alert: ScoredAlert,
  fundamentals: StockFundamentals | null | undefined,
): SellReviewInput {
  const f = fundamentals
  const negatives = alert.factors.filter((x: PickFactor) => x.tone === 'negative')
  const positives = alert.factors.filter((x: PickFactor) => x.tone === 'positive')

  return {
    ticker: alert.ticker,
    company_name: alert.company_name,
    severity: alert.severity,
    score: alert.score,
    headline: alert.headline,
    position_pnl_pct: alert.holding.position_pnl_pct,
    avg_cost_basis: alert.holding.avg_cost_basis,
    current_price: alert.holding.current_price,
    quantity: alert.holding.quantity,
    change_7d_pct: f?.change_7d_pct ?? null,
    change_14d_pct: f?.change_14d_pct ?? null,
    change_30d_pct: f?.change_30d_pct ?? null,
    analyst_buy: f?.analyst_buy ?? 0,
    analyst_hold: f?.analyst_hold ?? 0,
    analyst_sell: f?.analyst_sell ?? 0,
    analyst_total: (f?.analyst_buy ?? 0) + (f?.analyst_hold ?? 0) + (f?.analyst_sell ?? 0),
    news_sentiment: f?.news_sentiment ?? null,
    week52_high: f?.week52_high ?? null,
    week52_low: f?.week52_low ?? null,
    target_price: f?.target_price ?? f?.target_mean ?? null,
    support_20d: f?.support_20d ?? null,
    negative_factors: negatives.map((x: PickFactor) => ({
      label: x.label,
      value: x.value,
      tone: 'bearish' as const,
    })),
    positive_factors: positives.map((x: PickFactor) => ({
      label: x.label,
      value: x.value,
      tone: 'bullish' as const,
    })),
  }
}

export function mechanicalSellReview(alert: ScoredAlert): { review_reason: string; caveat: string } {
  const h = alert.holding
  const negatives = alert.factors.filter((f: PickFactor) => f.tone === 'negative')
  const positives = alert.factors.filter((f: PickFactor) => f.tone === 'positive')

  const pnl = h.position_pnl_pct
  const pnlWord = pnl >= 0 ? 'up' : 'down'
  const opening = `You own ${h.quantity} shares of ${alert.ticker} at an average cost of $${h.avg_cost_basis.toFixed(2)}; the stock is at $${h.current_price.toFixed(2)}, so you are ${pnlWord} ${Math.abs(pnl).toFixed(1)}% versus what you paid.`

  const concernBlock =
    negatives.length > 0
      ? ` The scan flagged ${negatives.length} concern${negatives.length > 1 ? 's' : ''}: ${negatives.map(factorLine).join('; ')}.`
      : ''

  const offsetBlock =
    positives.length > 0
      ? ` Some positives remain (${positives.map(factorLine).join('; ')}), but they have not been enough to clear the weak overall picture.`
      : ''

  const outlook =
    alert.severity === 'red'
      ? ' Taken together, price action and fundamentals have not shown a dependable recovery pattern — if you were expecting improvement within the next one to three months, the data has not confirmed that yet.'
      : ' Several signals are soft enough to watch closely; if you need the position to recover within the next quarter, progress so far has been limited.'

  return {
    review_reason: `${opening}${concernBlock}${offsetBlock}${outlook}`,
    caveat: DEFAULT_CAVEAT,
  }
}

export const PORTFOLIO_ALERT_DEMO: PortfolioAlert[] = [
  {
    ticker: 'INTC',
    company_name: 'Intel Corporation',
    severity: 'red',
    score: 58,
    headline: ALERT_HEADLINES.red,
    holding: {
      quantity: 40,
      avg_cost_basis: 28.5,
      current_price: 21.2,
      position_pnl_pct: -25.6,
      position_value: 848,
      invested: 1140,
    },
    factors: [
      { label: 'Down on cost and still sliding', value: '-26% position · -14% in 30d', tone: 'negative' },
      { label: 'Heavy sell ratings', value: '12 of 35 analysts', tone: 'negative' },
      { label: 'Below recent support', tone: 'negative' },
    ],
    review_reason:
      'You own 40 shares of INTC at an average cost of $28.50; the stock is at $21.20, so you are down 25.6% versus what you paid. The scan flagged three concerns: Down on cost and still sliding (-26% position · -14% in 30d); Heavy sell ratings (12 of 35 analysts); Below recent support. Taken together, price action and fundamentals have not shown a dependable recovery pattern — if you were expecting improvement within the next one to three months, the data has not confirmed that yet.',
    caveat: DEFAULT_CAVEAT,
    narrative_source: 'mechanical',
  },
  {
    ticker: 'PYPL',
    company_name: 'PayPal Holdings',
    severity: 'watch',
    score: 32,
    headline: ALERT_HEADLINES.watch,
    holding: {
      quantity: 15,
      avg_cost_basis: 72,
      current_price: 64.5,
      position_pnl_pct: -10.4,
      position_value: 967.5,
      invested: 1080,
    },
    factors: [
      { label: 'No meaningful bounce yet', value: '-10% vs cost · flat 30d', tone: 'negative' },
      { label: 'Negative news tone', tone: 'negative' },
    ],
    review_reason:
      'You own 15 shares of PYPL at an average cost of $72.00; the stock is at $64.50, so you are down 10.4% versus what you paid. The scan flagged two concerns: No meaningful bounce yet (-10% vs cost · flat 30d); Negative news tone. Several signals are soft enough to watch closely; if you need the position to recover within the next quarter, progress so far has been limited.',
    caveat: DEFAULT_CAVEAT,
    narrative_source: 'mechanical',
  },
]
