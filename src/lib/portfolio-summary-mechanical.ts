import { PORTFOLIO_SUMMARY_TAG_LABELS } from '@/lib/portfolio-summary-tags'
import type { PortfolioSummarySentiment, PortfolioSummaryTag } from '@/types'

function fmtPct(n: number | null, digits = 0): string | null {
  if (n == null || !Number.isFinite(n)) return null
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

function tagPhrase(tags: PortfolioSummaryTag[]): string {
  if (!tags.length) return ''
  const labels = tags.slice(0, 2).map((t) => PORTFOLIO_SUMMARY_TAG_LABELS[t].toLowerCase())
  return ` Tags in play: ${labels.join(', ')}.`
}

type MechanicalHoldingInput = {
  ticker: string
  company_name: string | null
  price: number | null
  change_1d_pct: number | null
  change_30d_pct: number | null
  position_pnl_pct: number | null
  analyst_buy: number | null
  analyst_sell: number | null
  analyst_total: number | null
  tags: PortfolioSummaryTag[]
  sentiment: PortfolioSummarySentiment
  existing_review_reason?: string | null
  degraded: boolean
}

function momentumSentence(d1: number | null, d30: number | null): string {
  if (d30 != null && d30 <= -10) return 'The last month has been weak, with sellers still in control.'
  if (d30 != null && d30 >= 10) return 'The last month shows solid momentum behind the move.'
  if (d1 != null && d1 >= 1) return 'Today’s session is adding to recent strength.'
  if (d1 != null && d1 <= -1) return 'Today’s drop adds to a soft short-term picture.'
  return 'Recent price action has been fairly quiet.'
}

function analystSentence(buy: number | null, sell: number | null, total: number | null): string {
  if (!total || total < 3) return 'Analyst coverage is thin, so read the chart and your own plan carefully.'
  if (sell != null && buy != null && sell / total >= 0.35) {
    return `Analyst sentiment skews cautious (${sell} of ${total} rate it a sell).`
  }
  if (buy != null && buy / total >= 0.55) {
    return `Analyst ratings lean constructive (${buy} of ${total} are buys).`
  }
  return `Analyst views are mixed (${buy ?? 0} buy / ${sell ?? 0} sell).`
}

export function mechanicalHoldingSummary(input: MechanicalHoldingInput): string {
  if (input.existing_review_reason && !input.degraded) {
    const first = input.existing_review_reason.split('.')[0]?.trim()
    if (first) return `${first}. ${momentumSentence(input.change_1d_pct, input.change_30d_pct)}`
  }

  const d1 = fmtPct(input.change_1d_pct, 1)
  const pnl = fmtPct(input.position_pnl_pct, 0)
  const name = input.ticker

  const open =
    d1 != null && pnl != null
      ? `${name} is ${d1} today and ${pnl} versus your average cost.`
      : d1 != null
        ? `${name} is ${d1} today.`
        : `${name} has limited live price data right now.`

  const body = `${momentumSentence(input.change_1d_pct, input.change_30d_pct)} ${analystSentence(
    input.analyst_buy,
    input.analyst_sell,
    input.analyst_total,
  )}`

  return `${open} ${body}${tagPhrase(input.tags)}`.trim()
}

export function mechanicalHoldingHeadline(input: {
  ticker: string
  sentiment: PortfolioSummarySentiment
  change_1d_pct: number | null
  tags: PortfolioSummaryTag[]
}): string {
  if (input.tags.includes('profit_target_reached')) return 'Near analyst target'
  if (input.sentiment === 'negative') return 'Weighing on portfolio today'
  if (input.sentiment === 'positive' && (input.change_1d_pct ?? 0) > 0) return 'Leading today'
  if (input.tags.includes('earnings_soon')) return 'Earnings coming up'
  return `${input.ticker} update`
}

export function mechanicalPortfolioHeadline(input: {
  portfolio_sentiment: PortfolioSummarySentiment
  day_pct: number | null
  leaders: string[]
  laggards: string[]
}): string {
  const day =
    input.day_pct != null
      ? input.day_pct >= 0
        ? `up about ${Math.abs(input.day_pct).toFixed(1)}% today`
        : `down about ${Math.abs(input.day_pct).toFixed(1)}% today`
      : 'mixed today'

  const drag =
    input.laggards.length > 0 ? `; ${input.laggards.slice(0, 2).join(' and ')} are the main drag` : ''
  const lift =
    input.leaders.length > 0 && input.portfolio_sentiment === 'positive'
      ? `, led by ${input.leaders.slice(0, 2).join(' and ')}`
      : ''

  return `Portfolio is ${day}${lift}${drag}.`.replace(';. ', '; ')
}
