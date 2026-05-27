/** Key research — Finnhub (+ FMP gap-fill). Used by cron + first-time DB fill. */

import { env } from '@/lib/env'
import type { StockResearchSnapshot } from '@/types'

function num(value: unknown): number | null {
  if (value == null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function firstNum(...values: unknown[]): number | null {
  for (const v of values) {
    const n = num(v)
    if (n != null) return n
  }
  return null
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Decimal (0.04) or percent (4) → display percent. */
function asPct(value: number | null): number | null {
  if (value == null) return null
  if (Math.abs(value) <= 1.5) return value * 100
  return value
}

async function finnhubGet<T>(path: string, params: Record<string, string>): Promise<T | null> {
  const qs = new URLSearchParams({ ...params, token: env.FINNHUB_API_KEY })
  try {
    const res = await fetch(`https://finnhub.io/api/v1${path}?${qs}`, { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

async function fetchFinnhubMetric(sym: string): Promise<Record<string, unknown> | null> {
  const data = await finnhubGet<{ metric?: Record<string, unknown> }>('/stock/metric', {
    symbol: sym,
    metric: 'all',
  })
  return data?.metric ?? null
}

async function fetchFinnhubProfile(sym: string): Promise<Record<string, unknown> | null> {
  return finnhubGet<Record<string, unknown>>('/stock/profile2', { symbol: sym })
}

async function fetchFinnhubNextEarnings(sym: string): Promise<string | null> {
  const from = isoDate(new Date())
  const to = isoDate(new Date(Date.now() + 366 * 86_400_000))
  const data = await finnhubGet<{ earningsCalendar?: Array<{ date?: string; symbol?: string }> }>(
    '/calendar/earnings',
    { symbol: sym, from, to },
  )
  const rows = data?.earningsCalendar ?? []
  const upcoming = rows
    .filter((r) => r.symbol?.toUpperCase() === sym && r.date && r.date >= from)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
  return upcoming[0]?.date ?? null
}

async function fetchFinnhubNextExDiv(sym: string): Promise<string | null> {
  const from = isoDate(new Date())
  const to = isoDate(new Date(Date.now() + 366 * 86_400_000))
  const data = await finnhubGet<Array<{ exDate?: string }>>('/stock/dividend', {
    symbol: sym,
    from,
    to,
  })
  if (!Array.isArray(data)) return null
  const upcoming = data
    .filter((r) => r.exDate && r.exDate >= from)
    .sort((a, b) => String(a.exDate).localeCompare(String(b.exDate)))
  return upcoming[0]?.exDate ?? null
}

async function fetchFmpRow(sym: string, path: string): Promise<Record<string, unknown> | null> {
  if (!env.FMP_API_KEY) return null
  try {
    const url = `https://financialmodelingprep.com/api/v3/${path}/${sym}?apikey=${encodeURIComponent(env.FMP_API_KEY)}`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data) ? (data[0] as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function buildSnapshot(
  sym: string,
  metric: Record<string, unknown> | null,
  profile: Record<string, unknown> | null,
  earningsDate: string | null,
  exDiv: string | null,
  fmpRatios: Record<string, unknown> | null,
  fmpProfile: Record<string, unknown> | null,
  fmpGrowth: Record<string, unknown> | null,
): StockResearchSnapshot {
  const mcapMillions = firstNum(profile?.marketCapitalization, metric?.marketCapitalization)
  const market_cap =
    mcapMillions != null ? mcapMillions * 1_000_000 : firstNum(fmpProfile?.mktCap)

  return {
    ticker: sym,
    earnings_date: earningsDate,
    ex_dividend_date: exDiv,
    pe_trailing: firstNum(
      metric?.peBasicExclExtraTTM,
      metric?.peTTM,
      metric?.peRatioTTM,
      fmpRatios?.priceEarningsRatioTTM,
    ),
    pe_forward: firstNum(
      metric?.peNormalizedAnnual,
      metric?.forwardPE,
      fmpRatios?.priceEarningsRatioTTM,
    ),
    market_cap,
    beta: firstNum(metric?.beta, profile?.beta, fmpProfile?.beta),
    dividend_yield_pct: asPct(
      firstNum(
        metric?.dividendYieldIndicatedAnnual,
        metric?.currentDividendYieldTTM,
        fmpRatios?.dividendYieldTTM,
        fmpProfile?.lastDiv && fmpProfile?.price
          ? (num(fmpProfile.lastDiv)! / num(fmpProfile.price)!)
          : null,
      ),
    ),
    revenue_growth_pct: asPct(
      firstNum(metric?.revenueGrowthTTMYoy, fmpGrowth?.revenueGrowth),
    ),
    earnings_growth_pct: asPct(
      firstNum(metric?.epsGrowthTTMYoy, fmpGrowth?.epsgrowth, fmpGrowth?.netIncomeGrowth),
    ),
    gross_margin_pct: asPct(firstNum(metric?.grossMarginTTM, fmpRatios?.grossProfitMarginTTM)),
    operating_margin_pct: asPct(
      firstNum(metric?.operatingMarginTTM, fmpRatios?.operatingProfitMarginTTM),
    ),
    profit_margin_pct: asPct(firstNum(metric?.netProfitMarginTTM, fmpRatios?.netProfitMarginTTM)),
    debt_to_equity: firstNum(
      metric?.['totalDebt/totalEquityQuarterly'],
      metric?.totalDebtToEquityQuarterly,
      fmpRatios?.debtEquityRatioTTM,
    ),
    current_ratio: firstNum(
      metric?.currentRatioQuarterly,
      metric?.currentRatioAnnual,
      fmpRatios?.currentRatioTTM,
    ),
  }
}

function hasAnyResearchData(snapshot: StockResearchSnapshot): boolean {
  return [
    snapshot.earnings_date,
    snapshot.pe_trailing,
    snapshot.pe_forward,
    snapshot.market_cap,
    snapshot.beta,
    snapshot.revenue_growth_pct,
    snapshot.profit_margin_pct,
  ].some((v) => v != null)
}

/** Finnhub primary; FMP always fills gaps when FMP_API_KEY is set. */
export async function fetchStockResearchFromApis(ticker: string): Promise<StockResearchSnapshot | null> {
  const sym = ticker.toUpperCase()

  const [metric, profile, earningsDate, exDiv] = await Promise.all([
    fetchFinnhubMetric(sym),
    fetchFinnhubProfile(sym),
    fetchFinnhubNextEarnings(sym),
    fetchFinnhubNextExDiv(sym),
  ])

  let fmpRatios: Record<string, unknown> | null = null
  let fmpProfile: Record<string, unknown> | null = null
  let fmpGrowth: Record<string, unknown> | null = null
  if (env.FMP_API_KEY) {
    ;[fmpRatios, fmpProfile, fmpGrowth] = await Promise.all([
      fetchFmpRow(sym, 'ratios-ttm'),
      fetchFmpRow(sym, 'profile'),
      fetchFmpRow(sym, 'financial-growth'),
    ])
  }

  const snapshot = buildSnapshot(
    sym,
    metric,
    profile,
    earningsDate,
    exDiv,
    fmpRatios,
    fmpProfile,
    fmpGrowth,
  )
  return hasAnyResearchData(snapshot) ? snapshot : null
}
