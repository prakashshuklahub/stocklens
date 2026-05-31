// Portfolio review narratives.
// Scoring rules live in @/lib/portfolio-alert-scoring.

import type { HoldingSignalTier, PickFactor, StockFundamentals } from '@/types'
import type { SellReviewInput } from '@/lib/llm'
import {
  ALERT_HEADLINES,
  SIGNAL_HEADLINES,
  type ScoredAlert,
} from '@/lib/portfolio-alert-scoring'

export type { AlertScoreInput, ScoredAlert, HoldingSignalTier } from '@/lib/portfolio-alert-scoring'
export {
  scorePortfolioAlert,
  scoreHoldingSignal,
  scoreProfitZone,
  resolveTier,
  sortBySignalTier,
  rankAlerts,
  ALERT_RULES,
  ALERT_HEADLINES,
  SIGNAL_HEADLINES,
  TIER_BADGE_LABELS,
  PROFIT_ZONE_RULES,
  MIN_BEARISH_FACTORS,
  WATCH_SCORE_THRESHOLD,
  RED_SCORE_THRESHOLD,
} from '@/lib/portfolio-alert-scoring'

const DEFAULT_CAVEAT =
  'This is a data check to help you think—not a command to sell. Take your time and decide what fits your plan.'

const PROFIT_CAVEAT =
  'Targets and trends can change — this is context for your plan, not a prompt to sell or hold.'

function factorLine(f: { label: string; value?: string }): string {
  return f.value ? `${f.label} (${f.value})` : f.label
}

type FactorContext = {
  pnlPct: number
  value?: string
}

/** Pattern-specific sentences so each factor mix reads differently. */
const FACTOR_SENTENCES: Record<string, (ctx: FactorContext) => string> = {
  'Down on cost and still sliding': (ctx) =>
    `You're down ${Math.abs(ctx.pnlPct).toFixed(0)}% on this position, and recent weeks haven't shown a rebound — price is still drifting lower.`,
  'Underwater vs your cost': (ctx) =>
    `The stock is trading below your average cost (${ctx.value ?? `${ctx.pnlPct.toFixed(0)}%`}), so the position hasn't recovered what you paid.`,
  'No meaningful bounce yet': () =>
    'Despite being below your cost, the last month has been flat — there is no clear sign of a turnaround yet.',
  'Sharp 30-day decline': (ctx) =>
    `The last 30 days have been rough (${ctx.value ?? 'sharp drop'}), which adds pressure on top of your entry price.`,
  'Recent weeks still weak': (ctx) =>
    `Short-term momentum is still soft (${ctx.value ?? 'recent weeks down'}), even if the longer picture looks mixed.`,
  'Heavy sell ratings': (ctx) =>
    `Analyst sentiment skews cautious${ctx.value ? ` — ${ctx.value} rate it a sell` : ''}.`,
  'Negative news tone': () =>
    'Recent news coverage leans negative, which can weigh on sentiment even when the chart looks OK.',
  'Below recent support': () =>
    "Price has slipped below a recent support zone, which often means buyers haven't stepped in reliably.",
  'Near 52-week low': () =>
    "The stock is trading near its 52-week low — that usually means the market hasn't found a durable floor yet.",
  'Above typical target': (ctx) =>
    `Price sits above the typical analyst reference${ctx.value ? ` (${ctx.value})` : ''}, which can mean much of the expected upside is already priced in.`,
}

function describeFactors(factors: PickFactor[]): string {
  const negatives = factors.filter((f) => f.tone === 'negative')
  if (!negatives.length) return ''

  const parts = negatives.map((f) => {
    const fn = FACTOR_SENTENCES[f.label]
    const ctx: FactorContext = { pnlPct: 0, value: f.value }
    if (fn) return fn(ctx)
    return factorLine(f)
  })

  if (parts.length === 1) return parts[0]
  if (parts.length === 2) return `${parts[0]} Also, ${parts[1].charAt(0).toLowerCase()}${parts[1].slice(1)}`
  return `${parts.slice(0, -1).join(' ')} ${parts[parts.length - 1]}`
}

function describeOffsets(factors: PickFactor[]): string {
  const positives = factors.filter((f) => f.tone === 'positive')
  if (!positives.length) return ''
  const list = positives.map(factorLine).join('; ')
  return ` Some positives remain (${list}), but they haven't been enough to clear the weak overall picture.`
}

function positionOpening(h: ScoredAlert['holding'], ticker: string): string {
  const pnl = h.position_pnl_pct
  const pnlWord = pnl >= 0 ? 'up' : 'down'
  return `You own ${h.quantity} shares of ${ticker} at an average cost of $${h.avg_cost_basis.toFixed(2)}; the stock is at $${h.current_price.toFixed(2)}, so you are ${pnlWord} ${Math.abs(pnl).toFixed(1)}% versus what you paid.`
}

export function mechanicalSignalReview(
  alert: ScoredAlert,
  tier: Extract<HoldingSignalTier, 'soft' | 'attention'>,
): { review_reason: string; caveat: string } {
  const opening = positionOpening(alert.holding, alert.ticker)
  const factorBlock = describeFactors(alert.factors)
  const offsetBlock = describeOffsets(alert.factors)

  const factorCtx = factorBlock
    ? ` ${factorBlock.charAt(0).toUpperCase()}${factorBlock.slice(1)}`
    : ''

  const outlook =
    tier === 'attention'
      ? ' Taken together, price action and fundamentals have not shown a dependable recovery pattern — if you were expecting improvement within the next one to three months, the data has not confirmed that yet.'
      : ' Several signals are soft enough to watch closely; if you need the position to recover within the next quarter, progress so far has been limited.'

  return {
    review_reason: `${opening}${factorCtx}${offsetBlock}${outlook}`,
    caveat: DEFAULT_CAVEAT,
  }
}

/** @deprecated Use mechanicalSignalReview — kept for alerts route compatibility. */
export function mechanicalSellReview(alert: ScoredAlert): { review_reason: string; caveat: string } {
  const tier = alert.severity === 'red' ? 'attention' : 'soft'
  return mechanicalSignalReview(alert, tier)
}

export function mechanicalProfitReview(input: {
  ticker: string
  quantity: number
  avg_cost_basis: number
  current_price: number
  position_pnl_pct: number
  factors: PickFactor[]
}): { review_reason: string; caveat: string } {
  const { ticker, quantity, avg_cost_basis, current_price, position_pnl_pct, factors } = input
  const targetChip = factors.find((f) => f.label === 'Target in range')
  const opening = `You own ${quantity} shares of ${ticker} at an average cost of $${avg_cost_basis.toFixed(2)}; the stock is at $${current_price.toFixed(2)}, so you are up ${position_pnl_pct.toFixed(1)}% versus what you paid.`

  const targetLine = targetChip
    ? ` The price is near the analyst reference (${targetChip.value ?? 'target in range'}), which suggests much of the expected upside may already be reflected in the market.`
    : ' The price is near the analyst reference, which suggests much of the expected upside may already be reflected in the market.'

  const healthy = factors.filter((f) => f.label !== 'Target in range' && f.label !== 'Up on your cost')
  const healthyLine =
    healthy.length > 0
      ? ` Conditions still look broadly healthy (${healthy.map(factorLine).join('; ')}), so this is about timing and risk management — not a sign the story has broken.`
      : ''

  return {
    review_reason: `${opening}${targetLine}${healthyLine} If you were holding for a specific target, it may be reasonable to think about whether to lock in gains or trim exposure.`,
    caveat: PROFIT_CAVEAT,
  }
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
