'use client'

import useSWR from 'swr'
import { format, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { researchCollapsedPreview } from '@/lib/yahoo-research'
import type { StockResearchSnapshot } from '@/types'

export class ResearchPendingError extends Error {
  constructor() {
    super('Research pending')
    this.name = 'ResearchPendingError'
  }
}

async function fetchResearch(url: string): Promise<StockResearchSnapshot> {
  const res = await fetch(url)
  if (res.status === 404) throw new ResearchPendingError()
  if (!res.ok) throw new Error('Research fetch failed')
  return res.json()
}

function fmtPct(n: number | null | undefined, digits = 1, signed = true): string {
  if (n == null) return '—'
  const prefix = signed && n >= 0 ? '+' : ''
  return `${prefix}${n.toFixed(digits)}%`
}

function fmtYield(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n.toFixed(2)}%`
}

function fmtRatio(n: number | null | undefined, digits = 2): string {
  if (n == null) return '—'
  return n.toFixed(digits)
}

function fmtPe(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n < 0) return 'N/M'
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
    if (diff < 0) return null
    if (diff === 0) return 'today'
    if (diff === 1) return 'tomorrow'
    return `${diff}d`
  } catch {
    return null
  }
}

type StatItem = { label: string; value: string; tone?: 'pos' | 'neg' }

function StatRow({ label, value, tone }: StatItem) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1 min-w-0">
      <span className="type-meta text-zinc-500 shrink-0">{label}</span>
      <span
        className={cn(
          'type-meta font-semibold tabular-nums text-right truncate',
          tone === 'pos' && 'text-emerald-400',
          tone === 'neg' && 'text-red-400',
          !tone && 'text-zinc-200',
        )}
      >
        {value}
      </span>
    </div>
  )
}

function buildStats(data: StockResearchSnapshot): StatItem[] {
  const stats: StatItem[] = []
  const earnIn = earningsTiming(data.earnings_date)

  if (data.earnings_date) {
    stats.push({
      label: 'Earnings',
      value: earnIn
        ? `${formatShortDate(data.earnings_date)} · ${earnIn}`
        : formatShortDate(data.earnings_date),
    })
  }
  if (data.ex_dividend_date) {
    stats.push({ label: 'Ex-div', value: formatShortDate(data.ex_dividend_date) })
  }
  if (data.pe_trailing != null) {
    stats.push({ label: 'P/E', value: fmtPe(data.pe_trailing) })
  }
  if (data.pe_forward != null && data.pe_forward !== data.pe_trailing) {
    stats.push({ label: 'Fwd P/E', value: fmtPe(data.pe_forward) })
  }
  if (data.market_cap != null) {
    stats.push({ label: 'Mkt cap', value: formatMarketCap(data.market_cap) })
  }
  if (data.beta != null) {
    stats.push({ label: 'Beta', value: fmtRatio(data.beta, 2) })
  }
  if (data.dividend_yield_pct != null && data.dividend_yield_pct > 0) {
    stats.push({ label: 'Div yield', value: fmtYield(data.dividend_yield_pct) })
  }
  if (data.revenue_growth_pct != null) {
    stats.push({
      label: 'Rev YoY',
      value: fmtPct(data.revenue_growth_pct),
      tone: data.revenue_growth_pct >= 0 ? 'pos' : 'neg',
    })
  }
  if (data.earnings_growth_pct != null) {
    stats.push({
      label: 'EPS YoY',
      value: fmtPct(data.earnings_growth_pct),
      tone: data.earnings_growth_pct >= 0 ? 'pos' : 'neg',
    })
  }
  if (data.gross_margin_pct != null) {
    stats.push({
      label: 'Gross margin',
      value: fmtPct(data.gross_margin_pct, 1, false),
      tone: data.gross_margin_pct >= 0 ? undefined : 'neg',
    })
  }
  if (data.operating_margin_pct != null) {
    stats.push({
      label: 'Op margin',
      value: fmtPct(data.operating_margin_pct, 1, false),
      tone: data.operating_margin_pct >= 0 ? undefined : 'neg',
    })
  }
  if (data.profit_margin_pct != null) {
    stats.push({
      label: 'Profit margin',
      value: fmtPct(data.profit_margin_pct, 1, false),
      tone: data.profit_margin_pct >= 0 ? undefined : 'neg',
    })
  }
  if (data.debt_to_equity != null) {
    stats.push({ label: 'Debt/equity', value: fmtRatio(data.debt_to_equity, 1) })
  }
  if (data.current_ratio != null) {
    stats.push({ label: 'Current ratio', value: fmtRatio(data.current_ratio, 2) })
  }

  return stats
}

export { researchCollapsedPreview }

export default function StockResearchPanel({ ticker }: { ticker: string }) {
  const { data, error, isLoading } = useSWR<StockResearchSnapshot>(
    `/api/research/${encodeURIComponent(ticker)}`,
    fetchResearch,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )

  const pending = error instanceof ResearchPendingError

  if (isLoading && !data) {
    return (
      <div className="rounded-lg bg-zinc-800/50 px-3 py-2.5 border border-white/[0.04] type-meta text-zinc-500 text-center">
        Loading…
      </div>
    )
  }

  if (pending && !data) {
    return (
      <div className="rounded-lg bg-zinc-800/50 px-3 py-2.5 border border-white/[0.04] type-meta text-zinc-500 text-center">
        Syncing research — try again shortly
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="rounded-lg bg-zinc-800/50 px-3 py-2.5 border border-white/[0.04] type-meta text-zinc-500 text-center">
        Research unavailable
      </div>
    )
  }

  if (!data) return null

  const stats = buildStats(data)
  if (!stats.length) {
    return (
      <div className="rounded-lg bg-zinc-800/50 px-3 py-2.5 border border-white/[0.04] type-meta text-zinc-500 text-center">
        No research metrics for this ticker yet
      </div>
    )
  }

  return (
    <div className="rounded-lg bg-zinc-800/50 px-3 py-1 border border-white/[0.04] divide-y divide-white/[0.04]">
      {stats.map((s) => (
        <StatRow key={s.label} {...s} />
      ))}
    </div>
  )
}
