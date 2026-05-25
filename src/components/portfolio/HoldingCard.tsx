'use client'

import { useState } from 'react'
import { Eye } from 'lucide-react'
import CollapseChevron from '@/components/CollapseChevron'
import StockLogo from '@/components/StockLogo'
import { TIER_BADGE_LABELS } from '@/lib/portfolio-alerts'
import { cn } from '@/lib/utils'
import type { HoldingSignal, HoldingSignalTier, PickFactor, PortfolioHoldingWithSignal } from '@/types'

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function truncatePreview(text: string, max = 72): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).trim()}…`
}

function tierBadgeClass(tier: HoldingSignalTier): string {
  if (tier === 'attention') return 'bg-red-500/20 text-red-300'
  if (tier === 'soft') return 'bg-amber-500/15 text-amber-300'
  if (tier === 'profit') return 'bg-emerald-500/15 text-emerald-300'
  return ''
}

function tierBorderClass(tier: HoldingSignalTier): string {
  if (tier === 'attention') return 'border-red-500/20'
  if (tier === 'soft') return 'border-amber-500/15'
  if (tier === 'profit') return 'border-emerald-500/15'
  return 'border-white/[0.06]'
}

function SignalFactorChip({ factor }: { factor: PickFactor }) {
  const tone =
    factor.tone === 'negative' ? 'bg-red-500/10 text-red-300' :
    factor.tone === 'positive' ? 'bg-emerald-500/10 text-emerald-300' :
    'bg-zinc-800 text-zinc-400'
  return (
    <span className={cn('type-meta font-semibold px-2 py-1 rounded-full whitespace-nowrap', tone)}>
      {factor.label}
      {factor.value && <span className="opacity-70 ml-1 font-normal">· {factor.value}</span>}
    </span>
  )
}

function signalFactorsSummary(factors: PickFactor[]): string {
  const negatives = factors.filter((f) => f.tone === 'negative').length
  const positives = factors.filter((f) => f.tone === 'positive').length
  const parts: string[] = []
  if (negatives > 0) parts.push(`${negatives} concern${negatives !== 1 ? 's' : ''}`)
  if (positives > 0) parts.push(`${positives} positive`)
  return parts.join(' · ') || `${factors.length} tag${factors.length !== 1 ? 's' : ''}`
}

function SignalDetailRow({
  ticker,
  signal,
  preview,
}: {
  ticker: string
  signal: HoldingSignal
  preview?: boolean
}) {
  const [open, setOpen] = useState(false)

  const isAttention = signal.tier === 'attention'
  const isProfit = signal.tier === 'profit'
  const cardId = `holding-signal-${ticker}`
  const label = isProfit ? 'Why target reached?' : 'Why this is flagged?'
  const factorSummary = signal.factors.length > 0 ? signalFactorsSummary(signal.factors) : null

  const collapsedPreview = factorSummary
    ?? (signal.review_reason ? truncatePreview(signal.review_reason) : 'Tap to read more')

  return (
    <div className={cn(
      'border-t bg-black/20',
      isAttention ? 'border-red-500/10' : isProfit ? 'border-emerald-500/10' : 'border-amber-500/10',
    )}>
      <button
        type="button"
        id={`${cardId}-trigger`}
        aria-expanded={open}
        aria-controls={`${cardId}-panel`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full text-left px-4 py-2',
          'active:brightness-95 transition-all [touch-action:manipulation]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40',
        )}
      >
        <div className="flex items-center justify-between gap-2 min-h-[32px]">
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            <Eye className="w-3 h-3 text-zinc-500 shrink-0" aria-hidden="true" />
            <span className="type-meta font-semibold text-zinc-300 shrink-0">{label}</span>
            {!open && collapsedPreview && (
              <>
                <span className="text-zinc-600 shrink-0" aria-hidden="true">·</span>
                <span className="type-meta text-muted-preview truncate">{collapsedPreview}</span>
              </>
            )}
          </div>
          <CollapseChevron open={open} className="text-muted shrink-0" />
        </div>
      </button>
      {open && (
        <div
          id={`${cardId}-panel`}
          role="region"
          aria-labelledby={`${cardId}-trigger`}
          className="px-4 pb-4 pt-0 space-y-3"
        >
          {signal.factors.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {signal.factors.map((f, i) => (
                <SignalFactorChip key={i} factor={f} />
              ))}
            </div>
          )}
          {signal.review_reason && (
            <p className="text-sm text-zinc-200 leading-relaxed">{signal.review_reason}</p>
          )}
          {signal.caveat && (
            <p className="text-xs text-zinc-500 leading-relaxed border-l-2 border-zinc-700 pl-3">
              {signal.caveat}
            </p>
          )}
          {preview && (
            <p className="type-micro text-muted">Sample card for UI preview</p>
          )}
        </div>
      )}
    </div>
  )
}

export function HoldingCard({
  h,
  preview,
}: {
  h: PortfolioHoldingWithSignal
  preview?: boolean
}) {
  const price = h.snapshot?.price ?? null
  const change1d = h.snapshot?.change_1d_pct ?? null
  const currentValue = price != null ? price * h.quantity : null
  const invested = h.avg_cost_basis * h.quantity
  const pnl = currentValue != null ? currentValue - invested : null
  const pnlPct = invested && pnl != null ? (pnl / invested) * 100 : null
  const isPos = pnl != null ? pnl >= 0 : null
  const signal = h.signal
  const flagged = signal.tier !== 'quiet'

  return (
    <div className={cn(
      'card-surface overflow-hidden active:scale-[0.99] active:brightness-95 transition-all duration-100',
      flagged ? tierBorderClass(signal.tier) : 'border-white/[0.06]',
      preview && flagged && 'opacity-90',
    )}>
      <div className="px-4 py-3.5 space-y-2.5">
        <div className="flex items-start gap-3">
          <StockLogo ticker={h.ticker} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-lg font-bold text-white tracking-tight">{h.ticker}</span>
              {flagged && (
                <span className={cn(
                  'type-micro font-bold uppercase tracking-wide px-2 py-0.5 rounded-full',
                  tierBadgeClass(signal.tier),
                )}>
                  {TIER_BADGE_LABELS[signal.tier as keyof typeof TIER_BADGE_LABELS]}
                </span>
              )}
            </div>
            {h.company_name && (
              <p className="text-sm text-zinc-400 truncate leading-snug">{h.company_name}</p>
            )}
          </div>
          <div className="text-right shrink-0 flex flex-col items-end gap-1">
            <p className="text-base font-bold text-white tabular-nums leading-tight">
              {price != null ? `$${fmt(price)}` : '—'}
            </p>
            {change1d != null && (
              <div className="flex items-baseline justify-end gap-1.5">
                <span className="type-meta text-muted-preview shrink-0">Today</span>
                <span
                  className={cn(
                    'text-xs tabular-nums font-semibold leading-tight',
                    change1d >= 0 ? 'text-emerald-400' : 'text-red-400',
                  )}
                >
                  {change1d >= 0 ? '+' : ''}{fmt(change1d)}%
                </span>
              </div>
            )}
            {pnl != null && pnlPct != null && isPos != null && (
              <div className="flex items-baseline justify-end gap-1.5">
                <span className="type-meta text-muted-preview shrink-0">P&L</span>
                <span
                  className={cn(
                    'text-xs tabular-nums font-semibold leading-tight',
                    isPos ? 'text-emerald-400' : 'text-red-400',
                  )}
                >
                  {isPos ? '+' : '-'}${fmt(Math.abs(pnl))}
                  {' '}
                  <span className="opacity-90">({isPos ? '+' : ''}{fmt(pnlPct)}%)</span>
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-1">
          <p className="type-meta text-zinc-300 tabular-nums">
            <span className="font-semibold text-white">{fmt(h.quantity, 0)} shares</span>
            {' '}@ ${fmt(h.avg_cost_basis)} avg
          </p>
          <p className="type-meta text-muted-preview tabular-nums">
            Invested ${fmt(invested)}
            {currentValue != null && (
              <> → worth <span className="text-zinc-200 font-semibold">${fmt(currentValue)}</span></>
            )}
          </p>
        </div>
      </div>

      {flagged && (
        <SignalDetailRow ticker={h.ticker} signal={signal} preview={preview} />
      )}
    </div>
  )
}
