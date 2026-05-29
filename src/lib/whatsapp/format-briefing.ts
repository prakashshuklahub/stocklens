import { formatIstShortDate } from '@/lib/whatsapp/ist-day'
import { PORTFOLIO_SUMMARY_TAG_LABELS } from '@/lib/portfolio-summary-tags'
import type { HoldingDailySummary, PortfolioDailySummaryPayload, PortfolioSummarySentiment } from '@/types'

const STALE_MS = 24 * 3600 * 1000
/** WhatsApp message limit is 4096; leave room for footer. */
const WHATSAPP_SAFE_MAX = 3900
const MAX_TAGS = 2

const FOOTER = '\n\nReply STOP to opt out'

export type FormatBriefingOptions = {
  payload: PortfolioDailySummaryPayload
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
  return `*${h.ticker}*\n${holdingLabelsLine(h)}\n${h.summary.trim()}\n`
}

export function formatBriefingForWhatsApp(options: FormatBriefingOptions): string {
  const { payload } = options

  const ageMs = Date.now() - new Date(payload.generated_at).getTime()
  const isStale = ageMs > STALE_MS

  const headerLines = ['Stocklens · Daily briefing']
  if (isStale) {
    headerLines.push(`As of ${formatIstShortDate(payload.generated_at)}`)
  }

  let body = [...headerLines, '', payload.portfolio_headline.trim(), ''].join('\n')

  let omitted = 0
  for (let i = 0; i < payload.holdings.length; i++) {
    const h = payload.holdings[i]!
    const block = formatHoldingBlock(h)
    const overflowNote = omitted > 0 ? '' : `\n+${payload.holdings.length - i} more in the app\n`
    const projected = body + block + overflowNote + FOOTER

    if (projected.length > WHATSAPP_SAFE_MAX) {
      omitted = payload.holdings.length - i
      break
    }
    body += block
  }

  if (omitted > 0) {
    body += `\n+${omitted} more in the app\n`
  }

  return (body.trimEnd() + FOOTER).trim()
}
