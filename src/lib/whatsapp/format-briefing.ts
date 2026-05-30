import { formatIstShortDate } from '@/lib/whatsapp/ist-day'
import { PORTFOLIO_SUMMARY_TAG_LABELS } from '@/lib/portfolio-summary-tags'
import type { HoldingDailySummary, PortfolioDailySummaryPayload, PortfolioSummarySentiment } from '@/types'

const STALE_MS = 24 * 3600 * 1000
/** WhatsApp message limit is 4096; leave room for footer. */
const WHATSAPP_SAFE_MAX = 3900
const MAX_TAGS = 2

const HOLDING_DIVIDER = '\n\n────────────────\n\n'
const FOOTER = '\n\n—\n_Reply STOP to opt out_'

export type FormatBriefingOptions = {
  payload: PortfolioDailySummaryPayload
}

function sentimentEmoji(s: PortfolioSummarySentiment): string {
  if (s === 'positive') return '🟢'
  if (s === 'negative') return '🔴'
  return '⚪'
}

function portfolioEmoji(s: PortfolioSummarySentiment): string {
  if (s === 'positive') return '📈'
  if (s === 'negative') return '📉'
  return '📊'
}

function sentimentLabel(s: PortfolioSummarySentiment): string {
  if (s === 'positive') return 'Positive'
  if (s === 'negative') return 'Negative'
  return 'Neutral'
}

function holdingLabelsLine(h: HoldingDailySummary): string {
  const parts = [sentimentLabel(h.sentiment)]
  for (const tag of h.tags.slice(0, MAX_TAGS)) {
    parts.push(PORTFOLIO_SUMMARY_TAG_LABELS[tag])
  }
  return parts.join(' · ')
}

function formatHoldingBlock(h: HoldingDailySummary): string {
  return [
    `*${h.ticker}*`,
    `${sentimentEmoji(h.sentiment)} ${holdingLabelsLine(h)}`,
    '',
    h.summary.trim(),
  ].join('\n')
}

function formatOverflowNote(remaining: number): string {
  if (remaining <= 0) return ''
  return `\n\n➕ *+${remaining} more in the app*`
}

function buildHeader(payload: PortfolioDailySummaryPayload, isStale: boolean): string {
  const lines = ['📊 *Stocklens · Daily briefing*']
  if (isStale) {
    lines.push(`🕐 As of ${formatIstShortDate(payload.generated_at)}`)
  }
  lines.push(
    '',
    `${portfolioEmoji(payload.portfolio_sentiment)} *${payload.portfolio_headline.trim()}*`,
    '',
  )
  return lines.join('\n')
}

export function formatBriefingForWhatsApp(options: FormatBriefingOptions): string {
  const { payload } = options

  const ageMs = Date.now() - new Date(payload.generated_at).getTime()
  const isStale = ageMs > STALE_MS

  let body = buildHeader(payload, isStale)

  let omitted = 0
  for (let i = 0; i < payload.holdings.length; i++) {
    const h = payload.holdings[i]!
    const prefix = i > 0 ? HOLDING_DIVIDER : ''
    const block = prefix + formatHoldingBlock(h)
    const overflowNote = omitted > 0 ? '' : formatOverflowNote(payload.holdings.length - i)
    const projected = body + block + overflowNote + FOOTER

    if (projected.length > WHATSAPP_SAFE_MAX) {
      omitted = payload.holdings.length - i
      break
    }
    body += block
  }

  if (omitted > 0) {
    body += formatOverflowNote(omitted)
  }

  return (body.trimEnd() + FOOTER).trim()
}
