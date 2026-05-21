// StockAnalysis.com — analyst consensus from /stocks/{ticker}/forecast/ (server-side scrape).

import type { PriceTargetFields } from '@/lib/yahoo-session'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const SCRAPE_DELAY_MS = 450
let lastFetchAt = 0

function positiveNum(text: string | undefined): number | null {
  if (!text) return null
  const n = Number(text.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : null
}

async function throttle() {
  const elapsed = Date.now() - lastFetchAt
  if (elapsed < SCRAPE_DELAY_MS) {
    await new Promise((r) => setTimeout(r, SCRAPE_DELAY_MS - elapsed))
  }
  lastFetchAt = Date.now()
}

export function parseStockAnalysisForecastHtml(html: string): PriceTargetFields | null {
  const meanMatch = html.match(/Price Target:\s*<span[^>]*>\$?([\d,.]+)/i)
  const rangeMatch = html.match(/lowest is \$([\d,.]+)[\s\S]*?highest is \$([\d,.]+)/i)

  const target_mean = positiveNum(meanMatch?.[1])
  if (target_mean == null) return null

  const target_low = positiveNum(rangeMatch?.[1])
  const target_high = positiveNum(rangeMatch?.[2])

  return {
    target_mean,
    target_low: target_low ?? null,
    target_high: target_high ?? null,
  }
}

export async function fetchStockAnalysisPriceTarget(ticker: string): Promise<PriceTargetFields | null> {
  const sym = ticker.toUpperCase()
  await throttle()

  try {
    const res = await fetch(`https://stockanalysis.com/stocks/${sym.toLowerCase()}/forecast/`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      cache: 'no-store',
    })

    if (!res.ok) {
      console.warn(`[price-target] ${sym}: stockanalysis http=${res.status}`)
      return null
    }

    const html = await res.text()
    const parsed = parseStockAnalysisForecastHtml(html)
    if (!parsed?.target_mean) {
      console.warn(`[price-target] ${sym}: stockanalysis empty`)
      return null
    }

    return parsed
  } catch (err) {
    console.warn(`[price-target] ${sym}: stockanalysis error`, err instanceof Error ? err.message : err)
    return null
  }
}
