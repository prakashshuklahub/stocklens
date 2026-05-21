// Conservative portfolio review scoring.
// Flags positions where holding 1–3 more months still looks weak on multiple signals.
// Not a "sell now" engine — requires several independent bearish factors.

import type { PickFactor, PortfolioAlert, PortfolioHolding, StockFundamentals } from '@/types'

export interface AlertScoreInput {
  holding: PortfolioHolding
  current_price: number
  fundamentals: StockFundamentals | null
}

export type ScoredAlert = Omit<PortfolioAlert, 'review_reason' | 'caveat' | 'narrative_source'>

const MIN_FACTORS = 2
const WATCH_SCORE = 24
const RED_SCORE = 38

const DEFAULT_CAVEAT =
  'This is a data check to help you think—not a command to sell. Take your time and decide what fits your plan.'

export function scorePortfolioAlert(input: AlertScoreInput): ScoredAlert | null {
  const { holding, current_price, fundamentals: f } = input
  if (current_price <= 0) return null

  const factors: PickFactor[] = []
  let score = 0
  let bearishCount = 0

  const cost = holding.avg_cost_basis
  const positionPnlPct = cost > 0 ? ((current_price - cost) / cost) * 100 : 0
  const invested = cost * holding.quantity
  const positionValue = current_price * holding.quantity

  const buy = f?.analyst_buy ?? 0
  const hold = f?.analyst_hold ?? 0
  const sell = f?.analyst_sell ?? 0
  const analystTotal = buy + hold + sell
  const sellRatio = analystTotal > 0 ? sell / analystTotal : 0
  const buyRatio = analystTotal > 0 ? buy / analystTotal : 0

  function bearish(points: number, factor: PickFactor) {
    score += points
    bearishCount++
    factors.push(factor)
  }

  // ── Position pain + trend (1–3 month lens) ─────────────────────────────────
  if (positionPnlPct <= -15 && (f?.change_30d_pct ?? 0) < -5) {
    bearish(22, {
      label: 'Down on cost and still sliding',
      value: `${positionPnlPct.toFixed(0)}% position · ${(f?.change_30d_pct ?? 0).toFixed(0)}% in 30d`,
      tone: 'negative',
    })
  } else if (positionPnlPct <= -12) {
    bearish(14, {
      label: 'Underwater vs your cost',
      value: `${positionPnlPct.toFixed(0)}%`,
      tone: 'negative',
    })
  }

  if (f?.change_30d_pct != null && f.change_30d_pct < -12) {
    bearish(18, {
      label: 'Sharp 30-day decline',
      value: `${f.change_30d_pct.toFixed(0)}% in 30d`,
      tone: 'negative',
    })
  } else if (f?.change_14d_pct != null && f.change_14d_pct < -8 && (f.change_30d_pct ?? 0) < 0) {
    bearish(12, {
      label: 'Recent weeks still weak',
      value: `${f.change_14d_pct.toFixed(0)}% in 14d`,
      tone: 'negative',
    })
  }

  // Stuck underwater with no recovery
  if (positionPnlPct <= -10 && f?.change_30d_pct != null && f.change_30d_pct < 2 && f.change_30d_pct > -18) {
    bearish(14, {
      label: 'No meaningful bounce yet',
      value: `${positionPnlPct.toFixed(0)}% vs cost · flat 30d`,
      tone: 'negative',
    })
  }

  // ── Street + news ──────────────────────────────────────────────────────────
  if (analystTotal >= 3 && sellRatio >= 0.3) {
    bearish(20, {
      label: 'Heavy sell ratings',
      value: `${sell} of ${analystTotal} analysts`,
      tone: 'negative',
    })
  }

  if (f?.news_sentiment != null && f.news_sentiment < -0.35) {
    bearish(14, { label: 'Negative news tone', tone: 'negative' })
  }

  // ── Technical weakness ─────────────────────────────────────────────────────
  if (f?.support_20d && current_price < f.support_20d * 0.97) {
    bearish(12, { label: 'Below recent support', tone: 'negative' })
  }

  if (f?.week52_low && f.week52_high && current_price <= f.week52_low * 1.05) {
    bearish(14, { label: 'Near 52-week low', tone: 'negative' })
  }

  if (f?.target_price && current_price > f.target_price * 1.08) {
    bearish(10, {
      label: 'Above typical target',
      value: `${(((current_price - f.target_price) / f.target_price) * 100).toFixed(0)}% over ref.`,
      tone: 'negative',
    })
  } else if (!f?.target_price && f?.target_mean && current_price > f.target_mean * 1.08) {
    bearish(10, {
      label: 'Above typical target',
      value: `${(((current_price - f.target_mean) / f.target_mean) * 100).toFixed(0)}% over ref.`,
      tone: 'negative',
    })
  }

  // ── Bullish offsets (avoid crying wolf) ────────────────────────────────────
  if (buyRatio > 0.65 && analystTotal >= 8) {
    score -= 22
    factors.push({
      label: 'Strong buy ratings',
      value: `${buy} of ${analystTotal}`,
      tone: 'positive',
    })
  }

  if (f?.change_30d_pct != null && f.change_30d_pct > 12) {
    score -= 18
    factors.push({
      label: 'Healthy 30-day trend',
      value: `+${f.change_30d_pct.toFixed(0)}%`,
      tone: 'positive',
    })
  }

  if (f?.week52_high && current_price >= f.week52_high * 0.95) {
    score -= 15
    factors.push({ label: 'Near 52-week high', tone: 'positive' })
  }

  if (bearishCount < MIN_FACTORS || score < WATCH_SCORE) return null

  const severity: PortfolioAlert['severity'] = score >= RED_SCORE && bearishCount >= 3 ? 'red' : 'watch'

  const headline =
    severity === 'red'
      ? 'Worth a careful review — weak signals may persist for months'
      : 'On watch — several weak signals'

  return {
    ticker: holding.ticker,
    company_name: holding.company_name,
    severity,
    score,
    headline,
    holding: {
      quantity: holding.quantity,
      avg_cost_basis: cost,
      current_price,
      position_pnl_pct: positionPnlPct,
      position_value: positionValue,
      invested,
    },
    factors,
  }
}

export function rankAlerts(alerts: ScoredAlert[]): ScoredAlert[] {
  const order = { red: 2, watch: 1 }
  return [...alerts].sort((a, b) => {
    const sev = order[b.severity] - order[a.severity]
    if (sev !== 0) return sev
    return b.score - a.score
  })
}

export function mechanicalSellReview(alert: ScoredAlert): { review_reason: string; caveat: string } {
  const negatives = alert.factors.filter((f) => f.tone === 'negative')
  const lead = negatives[0]?.label.toLowerCase() ?? 'several weak signals'
  const second = negatives[1]?.label.toLowerCase()

  const reason = second
    ? `Your ${alert.ticker} position shows ${lead} and ${second}, and the trend has not improved enough to suggest a reliable 1–3 month recovery.`
    : `Your ${alert.ticker} position shows ${lead}, and price action has not shown a steady recovery pattern over recent weeks.`

  const pnl = alert.holding.position_pnl_pct
  const pnlNote =
    pnl <= -15
      ? ` You are down about ${Math.abs(pnl).toFixed(0)}% versus your average cost.`
      : ''

  return {
    review_reason: `${reason}${pnlNote} Consider whether you still want to hold this slot for the next few months.`,
    caveat: DEFAULT_CAVEAT,
  }
}

export const PORTFOLIO_ALERT_DEMO: PortfolioAlert[] = [
  {
    ticker: 'INTC',
    company_name: 'Intel Corporation',
    severity: 'red',
    score: 58,
    headline: 'Worth a careful review — weak signals may persist for months',
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
      'Your INTC position is well below your average cost with a weak 30-day trend and heavy sell ratings from analysts. Nothing in the recent data points to a dependable bounce over the next one to three months.',
    caveat: DEFAULT_CAVEAT,
    narrative_source: 'mechanical',
  },
  {
    ticker: 'PYPL',
    company_name: 'PayPal Holdings',
    severity: 'watch',
    score: 32,
    headline: 'On watch — several weak signals',
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
      'PYPL is still underwater versus your cost and has not built a clear recovery over the past month, with news tone staying negative. If you were counting on improvement within a quarter, the data has not confirmed that yet.',
    caveat: DEFAULT_CAVEAT,
    narrative_source: 'mechanical',
  },
]
