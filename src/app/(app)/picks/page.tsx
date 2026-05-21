'use client'

import useSWR from 'swr'
import { useCallback, useState } from 'react'
import AppNav from '@/components/AppNav'
import { useMarketOpen } from '@/hooks/useMarketOpen'
import {
  Sparkles,
  ChevronDown,
  TrendingUp,
  AlertTriangle,
  ShieldCheck,
  Briefcase,
} from 'lucide-react'
import StockLogo from '@/components/StockLogo'
import { pickDisplayCopy } from '@/lib/picks'
import { cn } from '@/lib/utils'
import type { Pick, PicksResponse, PickFactor } from '@/types'

const fetcher = async (u: string): Promise<PicksResponse> => {
  const res = await fetch(u, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load picks')
  return res.json()
}

function fmt(n: number, digits = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Confidence badge ──────────────────────────────────────────────────────────
function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const config = {
    high: { label: 'High', styles: 'bg-emerald-500/15 text-emerald-300' },
    medium: { label: 'Medium', styles: 'bg-yellow-500/15 text-yellow-300' },
    low: { label: 'Low', styles: 'bg-zinc-700/40 text-zinc-400' },
  }[level]
  return (
    <span
      aria-label={`${config.label} confidence`}
      className={cn(
        'shrink-0 whitespace-nowrap text-xs font-bold uppercase tracking-wide',
        'px-3 py-1.5 rounded-full',
        config.styles,
      )}
    >
      {config.label}
    </span>
  )
}

// ── Factor chip ───────────────────────────────────────────────────────────────
function FactorChip({ factor }: { factor: PickFactor }) {
  const tone =
    factor.tone === 'positive' ? 'bg-emerald-500/10 text-emerald-300' :
    factor.tone === 'negative' ? 'bg-red-500/10 text-red-300' :
    'bg-zinc-800 text-zinc-400'
  return (
    <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap', tone)}>
      {factor.label}
      {factor.value && <span className="opacity-70 ml-1 font-normal">· {factor.value}</span>}
    </span>
  )
}

// ── Target range bar ──────────────────────────────────────────────────────────
function TargetRange({ pick }: { pick: Pick }) {
  if (pick.target_low == null || pick.target_high == null || pick.target_high <= pick.target_low) return null
  const lo = pick.target_low
  const hi = pick.target_high
  const meanPos = Math.max(0, Math.min(100, ((pick.target_mean - lo) / (hi - lo)) * 100))
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-zinc-500 tabular-nums">
        <span>${fmt(lo)}</span>
        <span className="text-zinc-600 font-medium">Target price range</span>
        <span>${fmt(hi)}</span>
      </div>
      <div className="h-1.5 bg-zinc-700/40 rounded-full relative">
        <div
          className="absolute top-1/2 -translate-y-1/2 w-1 h-3 bg-zinc-300 rounded-full"
          style={{ left: `calc(${meanPos}% - 2px)` }}
          aria-label={`Target price $${fmt(pick.target_mean)}`}
        />
      </div>
    </div>
  )
}

// ── Pick card ─────────────────────────────────────────────────────────────────
function PickCard({ pick, rank }: { pick: Pick; rank: number }) {
  const [open, setOpen] = useState(false)
  const isPos = pick.upside_pct >= 0
  const targetCopy = pickDisplayCopy(pick.target_label)

  return (
    <div className="card-surface overflow-hidden">
      {/* ── Header (always visible) ── */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left px-5 py-4 active:bg-zinc-800/60 transition-colors [touch-action:manipulation]"
      >
        {/* Rank + Ticker + Confidence */}
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="text-[11px] font-bold text-zinc-500 tabular-nums w-5">#{rank}</span>
            <StockLogo ticker={pick.ticker} size="sm" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-white tracking-tight" translate="no">
                  {pick.ticker}
                </span>
                <span className="text-xs text-zinc-500 truncate">{pick.company_name}</span>
              </div>
              <p className="text-[11px] text-zinc-600 mt-0.5">
                {pick.sector ?? 'Unknown'} · watchlist
              </p>
            </div>
          </div>
          <ConfidenceBadge level={pick.confidence} />
        </div>

        {/* ── Buy zone / Target / Upside / Horizon block ── */}
        <div className="bg-zinc-800/50 rounded-xl px-3.5 py-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-y-2.5 gap-x-3">
            {/* Buy zone */}
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Buy zone</p>
              <p className="text-sm font-bold text-white tabular-nums leading-tight">
                ${fmt(pick.entry_low)} – ${fmt(pick.entry_high)}
              </p>
              <p className="text-[11px] text-zinc-500 tabular-nums">now ${fmt(pick.current_price)}</p>
            </div>
            {/* Target price */}
            <div className="text-right">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
                {targetCopy.targetHeading}
              </p>
              <p className="text-sm font-bold text-white tabular-nums leading-tight">${fmt(pick.target_mean)}</p>
              <p className="text-[11px] text-zinc-500">{targetCopy.targetSub}</p>
            </div>
            {/* Upside */}
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Upside</p>
              <p className={cn(
                'text-sm font-bold tabular-nums leading-tight',
                isPos ? 'text-emerald-400' : 'text-red-400'
              )}>
                {isPos ? '+' : ''}{pick.upside_pct.toFixed(1)}%
              </p>
              <p className="text-[11px] text-zinc-500 tabular-nums">
                +${fmt(pick.target_mean - pick.current_price)} {targetCopy.upsideSub}
              </p>
            </div>
            {/* Analyst ratings */}
            <div className="text-right">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Analysts</p>
              <p className="text-sm font-bold text-white tabular-nums leading-tight">
                {pick.analyst_buy} buy
              </p>
              <p className="text-[11px] text-zinc-500 tabular-nums">
                of {pick.analyst_total} total
              </p>
            </div>
          </div>
        </div>

        {/* Ownership tag */}
        {pick.ownership && (
          <div className="flex items-center gap-1.5 mt-2.5">
            <Briefcase className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
            <p className="text-[11px] text-zinc-400">
              You own <span className="text-zinc-200 font-semibold tabular-nums">{fmt(pick.ownership.shares, 0)}</span> shares
              <span className="text-zinc-600"> · avg ${fmt(pick.ownership.avg_cost_basis)}</span>
            </p>
          </div>
        )}

        {/* Factor chips */}
        {pick.factors.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {pick.factors.map((f, i) => (
              <FactorChip key={i} factor={f} />
            ))}
          </div>
        )}

        {/* Expand affordance */}
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/[0.04]">
          <span className="text-[11px] text-zinc-500 font-medium">
            {open ? 'Hide details' : 'Tap for thesis & risk'}
          </span>
          <ChevronDown
            className={cn('w-4 h-4 text-zinc-600 transition-transform duration-200', open ? 'rotate-180' : '')}
            aria-hidden="true"
          />
        </div>
      </button>

      {/* ── Expanded section ── */}
      {open && (
        <div className="px-4 pb-4 pt-1 space-y-4">
          {/* Thesis */}
          {pick.thesis && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">Thesis</p>
              </div>
              <p className="text-sm text-zinc-200 leading-relaxed">{pick.thesis}</p>
            </div>
          )}

          {/* Main risk */}
          {pick.main_risk && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
                <p className="text-[11px] font-bold text-yellow-400 uppercase tracking-wide">Main risk</p>
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">{pick.main_risk}</p>
            </div>
          )}

          {/* Target range visual */}
          <TargetRange pick={pick} />

          {/* Analyst breakdown */}
          <div>
            <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">
              Analyst coverage ({pick.analyst_total})
            </p>
            <div className="flex gap-2">
              <Mini label="Buy" value={pick.analyst_buy} tone="emerald" />
              <Mini label="Hold" value={pick.analyst_hold} tone="zinc" />
              <Mini label="Sell" value={pick.analyst_sell} tone="red" />
            </div>
          </div>

          {/* Source attribution */}
          <p className="text-[10px] text-zinc-600 pt-1">
            {pick.narrative_source === 'llm'
              ? 'Summary written by AI · prices and ratings from public market data'
              : 'Summary from matched signals · prices and ratings from public market data'}
          </p>
        </div>
      )}
    </div>
  )
}

function Mini({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'zinc' | 'red' }) {
  const styles = {
    emerald: 'bg-emerald-500/10 text-emerald-300',
    zinc: 'bg-zinc-800 text-zinc-300',
    red: 'bg-red-500/10 text-red-300',
  }[tone]
  return (
    <div className={cn('flex-1 rounded-xl py-2 text-center', styles)}>
      <p className="text-base font-bold tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] uppercase tracking-wide opacity-80">{label}</p>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PicksPage() {
  const marketOpen = useMarketOpen()
  const { data, isLoading, isValidating, mutate } = useSWR<PicksResponse>('/api/picks', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 0,
  })
  const [manualRefresh, setManualRefresh] = useState(false)

  const handleRefresh = useCallback(async () => {
    if (!marketOpen) return
    setManualRefresh(true)
    try {
      const fresh = await fetch('/api/picks?refresh=1', { cache: 'no-store' })
      if (!fresh.ok) throw new Error('refresh failed')
      const json = (await fresh.json()) as PicksResponse
      await mutate(json, { revalidate: false })
    } catch {
      await mutate(undefined, { revalidate: true })
    } finally {
      setManualRefresh(false)
    }
  }, [marketOpen, mutate])

  const refreshing = manualRefresh || (isValidating && !isLoading)

  return (
    <div className="min-h-screen bg-zinc-950">
      <AppNav onRefresh={handleRefresh} refreshing={refreshing} marketOpen={marketOpen} showRefresh />

      <main id="main" className="page-shell">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <h1 className="page-title">Picks</h1>
            <Sparkles className="w-5 h-5 text-blue-400 mb-1" aria-hidden="true" />
          </div>
          <p className="page-subtitle">Top buy candidates from your watchlist</p>
          {data?.generated_at && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <p className="text-xs text-zinc-400 font-medium">
                Updated <span className="text-zinc-300">{timeAgo(data.generated_at)}</span>
              </p>
              {data.llm_enabled && (
                <span className="text-[10px] text-blue-400/80 font-semibold uppercase tracking-wide ml-1">· AI</span>
              )}
            </div>
          )}
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-[200px] rounded-2xl bg-zinc-900 animate-pulse" style={{ animationDelay: `${n * 80}ms` }} />
            ))}
          </div>
        ) : !data ? (
          <p className="text-zinc-500 text-sm text-center py-16">Failed to load picks. Try refreshing.</p>
        ) : data.picks.length === 0 ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-3xl bg-zinc-900 flex items-center justify-center mx-auto mb-5">
              <Sparkles className="w-7 h-7 text-zinc-700" aria-hidden="true" />
            </div>
            <p className="text-white text-base font-semibold mb-1">No buy candidates today</p>
            <p className="text-zinc-500 text-sm max-w-[260px] mx-auto [text-wrap:pretty]">
              Your watchlist stocks don&apos;t meet our buy criteria right now. Check back after the next market move.
            </p>
          </div>
        ) : (
          <>
            <ul className="space-y-3">
              {data.picks.map((p, i) => (
                <li key={p.ticker}>
                  <PickCard pick={p} rank={i + 1} />
                </li>
              ))}
            </ul>

            {/* Disclaimer */}
            <div className="mt-6 flex items-start gap-2 px-1">
              <ShieldCheck className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-[11px] text-zinc-600 leading-relaxed">
                Not financial advice. Targets and upside are estimates to help you compare ideas—not promises of future prices.
                Always do your own research before buying.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
