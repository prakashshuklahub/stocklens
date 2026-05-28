import { formatIstShortDate } from '@/lib/whatsapp/ist-day'
import type { PortfolioDailySummaryPayload } from '@/types'

const STALE_MS = 24 * 3600 * 1000
/** WhatsApp message limit is 4096; leave room for footer. */
const WHATSAPP_SAFE_MAX = 3900

const FOOTER = '\n\nReply STOP to opt out'

export type FormatBriefingOptions = {
  payload: PortfolioDailySummaryPayload
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
    const block = `*${h.ticker}*\n${h.summary.trim()}\n`
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
