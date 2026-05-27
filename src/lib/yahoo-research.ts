import { fetchYahooQuoteSummaryModules, yahooRawNumber } from '@/lib/yahoo-session'
import type { StockResearchSnapshot } from '@/types'

export const RESEARCH_MODULES = 'calendarEvents,summaryDetail,financialData'

function yahooDecimalToPct(value: unknown): number | null {
  const n = yahooRawNumber(value)
  if (n == null) return null
  return n * 100
}

function yahooTimestampToIso(value: unknown): string | null {
  const sec = yahooRawNumber(value)
  if (sec == null || sec <= 0) return null
  return new Date(sec * 1000).toISOString().slice(0, 10)
}

function parseEarningsDate(calendarEvents: Record<string, unknown> | undefined): string | null {
  const earnings = calendarEvents?.earnings as { earningsDate?: unknown[] } | undefined
  const rawDates = earnings?.earningsDate
  if (!Array.isArray(rawDates) || !rawDates.length) return null

  const msValues = rawDates
    .map((d) => yahooRawNumber(d))
    .filter((t): t is number => t != null && t > 0)
    .map((t) => t * 1000)

  if (!msValues.length) return null

  const now = Date.now()
  const upcoming = msValues.filter((t) => t >= now - 86_400_000).sort((a, b) => a - b)[0]
  const picked = upcoming ?? msValues.sort((a, b) => b - a)[0]
  return new Date(picked).toISOString().slice(0, 10)
}

export function parseResearchModules(
  modules: Record<string, unknown>,
  ticker: string,
): StockResearchSnapshot {
  const calendarEvents = modules.calendarEvents as Record<string, unknown> | undefined
  const summaryDetail = modules.summaryDetail as Record<string, unknown> | undefined
  const financialData = modules.financialData as Record<string, unknown> | undefined

  return {
    ticker: ticker.toUpperCase(),
    earnings_date: parseEarningsDate(calendarEvents),
    ex_dividend_date: yahooTimestampToIso(calendarEvents?.exDividendDate),
    pe_trailing: yahooRawNumber(summaryDetail?.trailingPE),
    pe_forward: yahooRawNumber(summaryDetail?.forwardPE),
    market_cap: yahooRawNumber(summaryDetail?.marketCap),
    beta: yahooRawNumber(summaryDetail?.beta),
    dividend_yield_pct: yahooDecimalToPct(summaryDetail?.dividendYield),
    revenue_growth_pct: yahooDecimalToPct(financialData?.revenueGrowth),
    earnings_growth_pct: yahooDecimalToPct(financialData?.earningsGrowth),
    gross_margin_pct: yahooDecimalToPct(financialData?.grossMargins),
    operating_margin_pct: yahooDecimalToPct(financialData?.operatingMargins),
    profit_margin_pct: yahooDecimalToPct(financialData?.profitMargins),
    debt_to_equity: yahooRawNumber(financialData?.debtToEquity),
    current_ratio: yahooRawNumber(financialData?.currentRatio),
  }
}

/** Yahoo fetch for cron only — goes through serialized quoteSummary queue. */
export async function fetchYahooStockResearchFromYahoo(
  ticker: string,
): Promise<StockResearchSnapshot | null> {
  const sym = ticker.toUpperCase()
  const modules = await fetchYahooQuoteSummaryModules(sym, RESEARCH_MODULES)
  if (!modules) return null
  return parseResearchModules(modules, sym)
}

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
    parts.push(`Rev ${data.revenue_growth_pct >= 0 ? '+' : ''}${data.revenue_growth_pct.toFixed(0)}%`)
  } else if (data.profit_margin_pct != null) {
    parts.push(`Margin ${data.profit_margin_pct.toFixed(0)}%`)
  }

  return parts.length ? parts.join(' · ') : 'Earnings · P/E · growth & margins'
}
