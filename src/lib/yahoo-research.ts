/** Collapsed preview helper for Key research accordion. Data comes from Finnhub/FMP → DB. */

import type { StockResearchSnapshot } from '@/types'

export function researchCollapsedPreview(data?: StockResearchSnapshot): string {
  if (!data) return 'Earnings · P/E · growth & margins'

  const parts: string[] = []
  if (data.earnings_date) {
    const d = new Date(`${data.earnings_date}T12:00:00`)
    parts.push(`Reports ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`)
  }
  if (data.pe_trailing != null) parts.push(`P/E ${data.pe_trailing.toFixed(1)}`)
  else if (data.pe_forward != null) parts.push(`Fwd P/E ${data.pe_forward.toFixed(1)}`)
  if (data.revenue_growth_pct != null) {
    parts.push(`Rev YoY ${data.revenue_growth_pct >= 0 ? '+' : ''}${data.revenue_growth_pct.toFixed(0)}%`)
  } else if (data.profit_margin_pct != null) {
    parts.push(`Margin ${data.profit_margin_pct.toFixed(0)}%`)
  }

  return parts.length ? parts.join(' · ') : 'Earnings · P/E · growth & margins'
}
