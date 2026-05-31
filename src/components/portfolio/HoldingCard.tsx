'use client'

import { useState } from 'react'
import { Eye } from 'lucide-react'
import CollapseChevron from '@/components/CollapseChevron'
import StockLogo from '@/components/StockLogo'
import { TIER_BADGE_LABELS } from '@/lib/portfolio-alerts'
import {
  computeHoldingMetrics,
  fmtHolding,
  formatShareQty,
} from '@/lib/portfolio-holding-metrics'
import { cn } from '@/lib/utils'
import type { HoldingSignal, HoldingSignalTier, PickFactor, PortfolioHoldingWithSignal } from '@/types'

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

function pnlToneClass(isPos: boolean): string {
  return isPos ? 'text-emerald-400' : 'text-red-400'
}

function StatCell({
  label,
  value,
  detail,
  detailTone,
}: {
  label: string
  value: string
  detail?: string
  detailTone?: 'pos' | 'neg' | 'neutral'
}) {
  return (
    <div className="min-w-0">
      <p className="type-micro font-medium text-zinc-500 uppercase tracking-wide">{label}</p>
      <p className="text-sm font-semibold text-white tabular-nums leading-snug mt-0.5 truncate">{value}</p>
      {detail && (
        <p
          className={cn(
            'text-xs tabular-nums mt-0.5 truncate',
            detailTone === 'pos' && 'text-emerald-400/90',
            detailTone === 'neg' && 'text-red-400/90',
            (!detailTone || detailTone === 'neutral') && 'text-zinc-500',
          )}
        >
          {detail}
        </p>
      )}
    </div>
  )
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
}: {
  ticker: string
  signal: HoldingSignal
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
          'w-full text-left px-4 py-2.5',
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
            <p className="text-sm text-zinc-200 leading-relaxed [text-wrap:pretty]">{signal.review_reason}</p>
          )}
          {signal.caveat && (
            <p className="text-xs text-zinc-500 leading-relaxed border-l-2 border-zinc-700 pl-3">
              {signal.caveat}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function HoldingCard({
  h,
}: {
  h: PortfolioHoldingWithSignal
}) {
  const {
    price,
    change1d,
    currentValue,
    invested,
    pnl,
    pnlPct,
    isPos,
  } = computeHoldingMetrics(h)
  const signal = h.signal
  const flagged = signal.tier !== 'quiet'

  const priceDetail =
    change1d != null
      ? `${change1d >= 0 ? '+' : ''}${fmtHolding(change1d)}% today`
      : undefined
  const priceDetailTone: 'pos' | 'neg' | undefined =
    change1d != null ? (change1d >= 0 ? 'pos' : 'neg') : undefined

  return (
    <div className={cn(
      'card-surface overflow-hidden active:scale-[0.99] active:brightness-95 transition-all duration-100',
      flagged ? tierBorderClass(signal.tier) : 'border-white/[0.06]',
    )}>
      <div className="px-4 py-3.5">
        <div className="flex gap-3">
          <StockLogo ticker={h.ticker} size="md" className="shrink-0 mt-0.5" />

          <div className="flex-1 min-w-0">
            {/* Primary: identity + hero numbers */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
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
                  <p className="text-sm text-zinc-400 truncate leading-snug mt-0.5">{h.company_name}</p>
                )}
              </div>

              <div className="text-right shrink-0 tabular-nums">
                <p className="text-lg font-bold text-white leading-none">
                  {currentValue != null ? `$${fmtHolding(currentValue)}` : '—'}
                </p>
                {pnl != null && pnlPct != null && isPos != null && (
                  <p className={cn('text-sm font-semibold mt-1 leading-tight', pnlToneClass(isPos))}>
                    {isPos ? '+' : '-'}${fmtHolding(Math.abs(pnl))}
                    <span className="opacity-90 font-medium">
                      {' '}({isPos ? '+' : ''}{fmtHolding(pnlPct)}%)
                    </span>
                  </p>
                )}
              </div>
            </div>

            {/* Secondary: labeled stats grid — scan top-to-bottom, label then value */}
            <div className="mt-3 pt-3 border-t border-white/[0.06] grid grid-cols-3 gap-x-4 gap-y-3">
              <StatCell
                label="Position"
                value={`${formatShareQty(h.quantity)} sh`}
                detail={`Avg $${fmtHolding(h.avg_cost_basis)}`}
              />
              <StatCell
                label="Price"
                value={price != null ? `$${fmtHolding(price)}` : '—'}
                detail={priceDetail}
                detailTone={priceDetailTone}
              />
              <StatCell
                label="Invested"
                value={`$${fmtHolding(invested)}`}
              />
            </div>
          </div>
        </div>
      </div>

      {flagged && (
        <SignalDetailRow ticker={h.ticker} signal={signal} />
      )}
    </div>
  )
}
