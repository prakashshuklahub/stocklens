'use client'

import useSWR from 'swr'
import { format, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { researchCollapsedPreview } from '@/lib/yahoo-research'
import type { StockResearchSnapshot } from '@/types'

export class ResearchFetchError extends Error {
  readonly retryAfterSec: number

  constructor(retryAfterSec: number) {
    super('Research rate limited')
    this.retryAfterSec = retryAfterSec
  }
}

export class ResearchPendingError extends Error {
  constructor() {
    super('Research pending')
    this.name = 'ResearchPendingError'
  }
}

async function fetchResearch(url: string): Promise<StockResearchSnapshot> {
  const res = await fetch(url)
  if (res.status === 404) {
    throw new ResearchPendingError()
  }
  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { retry_after_sec?: number } | null
    const headerRetry = Number(res.headers.get('Retry-After'))
    const retrySec = body?.retry_after_sec ?? (Number.isFinite(headerRetry) ? headerRetry : 90)
    throw new ResearchFetchError(retrySec)
  }
  if (!res.ok) throw new Error('Research fetch failed')
  return res.json()
}

function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`
}

function fmtRatio(n: number | null | undefined, digits = 2): string {
  if (n == null) return '—'
  return n.toFixed(digits)
}

function fmtPe(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(1)
}

function formatMarketCap(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`
  return `$${n.toFixed(0)}`
}

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'MMM d, yyyy')
  } catch {
    return '—'
  }
}

function earningsTiming(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    const diff = Math.ceil((parseISO(iso).getTime() - Date.now()) / 86_400_000)
    if (diff < 0) return 'Past date — confirm on calendar'
    if (diff === 0) return 'Reports today'
    if (diff === 1) return 'Reports tomorrow'
    return `In ${diff} days`
  } catch {
    return null
  }
}

function StatCell({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="type-meta text-zinc-500 font-medium truncate">{label}</span>
      <span
        className={cn(
          'text-sm font-bold tabular-nums truncate',
          tone === 'pos' && 'text-emerald-400',
          tone === 'neg' && 'text-red-400',
          !tone && 'text-zinc-100',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="type-meta font-bold text-zinc-400 uppercase tracking-wide mb-2">{children}</p>
  )
}

export { researchCollapsedPreview }

export default function StockResearchPanel({ ticker }: { ticker: string }) {
  const { data, error, isLoading } = useSWR<StockResearchSnapshot>(
    `/api/research/${encodeURIComponent(ticker)}`,
    fetchResearch,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )

  const rateLimited = error instanceof ResearchFetchError
  const pending = error instanceof ResearchPendingError
  const retrySec = rateLimited ? error.retryAfterSec : 0

  if (isLoading && !data) {
    return (
      <div className="rounded-xl bg-zinc-800/50 px-3 py-4 border border-white/[0.04] type-meta text-zinc-500 text-center">
        Loading research data…
      </div>
    )
  }

  if (pending && !data) {
    return (
      <div className="rounded-xl bg-zinc-800/50 px-3 py-4 border border-white/[0.04] type-meta text-zinc-400 text-center space-y-1">
        <p>Research syncs hourly from Yahoo.</p>
        <p className="text-zinc-500">This ticker should fill on the next run — check back soon.</p>
      </div>
    )
  }

  if (rateLimited && !data) {
    return (
      <div className="rounded-xl bg-zinc-800/50 px-3 py-4 border border-amber-500/20 type-meta text-zinc-400 text-center space-y-1">
        <p>Yahoo is rate-limiting research data.</p>
        <p className="text-amber-300/90">
          Try again in ~{Math.max(1, Math.ceil(retrySec / 60))} min
        </p>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="rounded-xl bg-zinc-800/50 px-3 py-4 border border-white/[0.04] type-meta text-zinc-500 text-center">
        Research data unavailable right now
      </div>
    )
  }

  if (!data) return null

  const earningsNote = earningsTiming(data.earnings_date)
  const revTone =
    data.revenue_growth_pct == null ? undefined : data.revenue_growth_pct >= 0 ? 'pos' : 'neg'
  const earnTone =
    data.earnings_growth_pct == null ? undefined : data.earnings_growth_pct >= 0 ? 'pos' : 'neg'

  return (
    <div className="rounded-xl bg-zinc-800/50 px-3 py-2.5 border border-white/[0.04] space-y-3">
      <div>
        <SectionTitle>Earnings & dividends</SectionTitle>
        <div className="grid grid-cols-2 gap-3">
          <StatCell label="Next earnings" value={formatShortDate(data.earnings_date)} />
          <StatCell label="Ex-dividend" value={formatShortDate(data.ex_dividend_date)} />
        </div>
        {earningsNote && (
          <p className="type-meta text-amber-300/90 mt-1.5">{earningsNote}</p>
        )}
      </div>

      <div className="border-t border-white/[0.04] pt-3">
        <SectionTitle>Valuation</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCell label="P/E (trailing)" value={fmtPe(data.pe_trailing)} />
          <StatCell label="P/E (forward)" value={fmtPe(data.pe_forward)} />
          <StatCell label="Market cap" value={formatMarketCap(data.market_cap)} />
          <StatCell label="Beta" value={fmtRatio(data.beta, 2)} />
          <StatCell label="Div yield" value={fmtPct(data.dividend_yield_pct, 2)} />
        </div>
      </div>

      <div className="border-t border-white/[0.04] pt-3">
        <SectionTitle>Financial health</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <StatCell label="Revenue growth" value={fmtPct(data.revenue_growth_pct)} tone={revTone} />
          <StatCell label="Earnings growth" value={fmtPct(data.earnings_growth_pct)} tone={earnTone} />
          <StatCell label="Gross margin" value={fmtPct(data.gross_margin_pct)} />
          <StatCell label="Operating margin" value={fmtPct(data.operating_margin_pct)} />
          <StatCell label="Profit margin" value={fmtPct(data.profit_margin_pct)} />
          <StatCell label="Debt / equity" value={fmtRatio(data.debt_to_equity, 1)} />
          <StatCell label="Current ratio" value={fmtRatio(data.current_ratio, 2)} />
        </div>
      </div>
    </div>
  )
}
