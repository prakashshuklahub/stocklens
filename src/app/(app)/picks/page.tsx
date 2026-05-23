'use client'

import useSWR from 'swr'
import { useCallback, useState } from 'react'
import AppNav from '@/components/AppNav'
import { useMarketOpen } from '@/hooks/useMarketOpen'
import CollapseChevron from '@/components/CollapseChevron'
import {
  Sparkles,
  TrendingUp,
  AlertTriangle,
  ShieldCheck,
  Briefcase,
  Eye,
  BarChart3,
  Compass,
} from 'lucide-react'
import StockLogo from '@/components/StockLogo'
import Week52Range from '@/components/Week52Range'
import { pickDisplayCopy } from '@/lib/picks'
import { relativeStrengthUserCopy, sectorEtfSubtitle, vsSectorBadgeLabel, vsSectorSpreadLabel } from '@/lib/sector-relative-strength'
import {
  formatTargetPrice,
  formatUpsideDollar,
  formatUpsidePct,
  hasDisplayTargetFromPickLabel,
  TARGET_UNAVAILABLE,
} from '@/lib/target-price-display'
import { cn } from '@/lib/utils'
import type { Pick, PicksResponse, PickFactor, PickSourceTag } from '@/types'

function allPicksFingerprint(data: PicksResponse): string {
  const rows = [...data.your_picks, ...data.discovery_picks]
  return rows.map((p) => `${p.ticker}:${p.score}:${p.current_price}:${p.upside_pct}`).join('|')
}

const scoresFingerprintRef = { current: '' }
const stableScoresAtRef = { current: null as string | null }

const fetcher = async (u: string): Promise<PicksResponse> => {
  const res = await fetch(u, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load picks')
  const fresh = (await res.json()) as PicksResponse
  const fp = allPicksFingerprint(fresh)
  if (fp && fp === scoresFingerprintRef.current && stableScoresAtRef.current) {
    fresh.scores_at = stableScoresAtRef.current
  } else {
    scoresFingerprintRef.current = fp
    stableScoresAtRef.current = fresh.scores_at
  }
  return fresh
}

function fmt(n: number, digits = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtPct(n: number | null | undefined, signed = true): string {
  if (n == null) return '—'
  const sign = signed && n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}%`
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

function sourceLabel(source: PickSourceTag): string {
  switch (source) {
    case 'watchlist': return 'Watchlist'
    case 'portfolio': return 'Portfolio'
    case 'both': return 'Watchlist · Portfolio'
    case 'discovery': return 'New idea'
  }
}

function sourceStyles(source: PickSourceTag): string {
  switch (source) {
    case 'discovery': return 'bg-orange-500/15 text-orange-300'
    case 'portfolio': return 'bg-blue-500/15 text-blue-300'
    case 'both': return 'bg-violet-500/15 text-violet-300'
    default: return 'bg-zinc-800 text-zinc-400'
  }
}

function ConfidenceBadge({ level }: { level: 'high' | 'medium' | 'low' }) {
  const config = {
    high: { label: 'High confidence', styles: 'bg-emerald-500/15 text-emerald-300' },
    medium: { label: 'Medium confidence', styles: 'bg-yellow-500/15 text-yellow-300' },
    low: { label: 'Low confidence', styles: 'bg-zinc-700/40 text-zinc-400' },
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

function MomentumStrip({ pick }: { pick: Pick }) {
  return (
    <div className="grid grid-cols-3 gap-2 pt-2 border-t border-white/[0.04]">
      <div>
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Today</p>
        <p className={cn(
          'text-sm font-bold tabular-nums',
          pick.change_1d_pct == null ? 'text-zinc-500' :
          pick.change_1d_pct >= 0 ? 'text-emerald-400' : 'text-red-400',
        )}>
          {fmtPct(pick.change_1d_pct)}
        </p>
      </div>
      <div className="text-center">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Past 2 weeks</p>
        <p className={cn(
          'text-sm font-bold tabular-nums',
          pick.change_14d_pct == null ? 'text-zinc-500' :
          pick.change_14d_pct >= 0 ? 'text-emerald-400' : 'text-red-400',
        )}>
          {fmtPct(pick.change_14d_pct)}
        </p>
      </div>
      <div className="text-right">
        <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Past month</p>
        <p className={cn(
          'text-sm font-bold tabular-nums',
          pick.change_30d_pct == null ? 'text-zinc-500' :
          pick.change_30d_pct >= 0 ? 'text-emerald-400' : 'text-red-400',
        )}>
          {fmtPct(pick.change_30d_pct)}
        </p>
      </div>
    </div>
  )
}

function VsSectorPanel({ pick }: { pick: Pick }) {
  const vs = pick.vs_sector
  if (!vs?.benchmark_ticker) return null

  const badge = vsSectorBadgeLabel(vs.badge)
  const rsCopy = vs.rs_score != null ? relativeStrengthUserCopy(vs.rs_score) : null
  const delta = vs.delta_7d ?? vs.delta_30d
  const spreadWindow = vs.delta_7d != null ? '7d' : '30d'
  const sectorName = pick.sector ?? 'sector'

  return (
    <div className="rounded-xl bg-zinc-900/80 border border-white/[0.04] px-3 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide mb-1">
            {rsCopy?.title ?? 'Compared to its sector'}
          </p>
          <p className="text-[11px] text-zinc-600 mb-1.5 leading-snug">
            {sectorEtfSubtitle(vs.benchmark_ticker, sectorName)}
          </p>
          {rsCopy ? (
            <>
              <p className="text-sm font-bold text-white">{rsCopy.tier}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5 leading-relaxed">{rsCopy.hint}</p>
            </>
          ) : (
            <p className="text-sm text-zinc-400">Loading comparison…</p>
          )}
        </div>
        {badge && (
          <span className={cn(
            'shrink-0 text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full',
            vs.badge === 'leader' ? 'bg-emerald-500/15 text-emerald-300' :
            vs.badge === 'lagger' ? 'bg-red-500/15 text-red-300' :
            'bg-zinc-800 text-zinc-400',
          )}>
            {badge}
          </span>
        )}
      </div>
      {delta != null && (
        <p className="text-[11px] text-zinc-500 mt-2 tabular-nums leading-relaxed">
          {vsSectorSpreadLabel(spreadWindow)}:{' '}
          <span className={delta >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            {delta >= 0 ? 'beat sector by ' : 'trailed sector by '}
            {fmtPct(Math.abs(delta), false)}
          </span>
        </p>
      )}
    </div>
  )
}

function PickCard({ pick, rank }: { pick: Pick; rank: number }) {
  const [open, setOpen] = useState(false)
  const showTarget = hasDisplayTargetFromPickLabel(pick.target_mean, pick.target_label)
  const upsidePct = showTarget ? pick.upside_pct : null
  const isPos = upsidePct != null && upsidePct >= 0
  const targetCopy = pickDisplayCopy(pick.target_label)
  const subline = showTarget ? targetCopy.targetSub : null
  const showAnalystRange =
    showTarget &&
    pick.target_low != null &&
    pick.target_high != null &&
    pick.target_high > pick.target_low

  return (
    <div className="card-surface overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left px-3.5 py-4 active:bg-zinc-800/60 transition-colors [touch-action:manipulation]"
      >
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="text-[11px] font-bold text-zinc-500 tabular-nums w-5">#{rank}</span>
            <StockLogo ticker={pick.ticker} size="sm" />
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span className="text-base font-bold text-white tracking-tight" translate="no">
                  {pick.ticker}
                </span>
                <span className="text-xs text-zinc-500 truncate">{pick.company_name}</span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <span className="text-[11px] text-zinc-600">{pick.sector ?? 'Unknown'}</span>
                <span className="text-[11px] text-zinc-600 tabular-nums">
                  · {pick.analyst_total} analyst{pick.analyst_total === 1 ? '' : 's'}
                </span>
                <span className={cn('text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full', sourceStyles(pick.source))}>
                  {sourceLabel(pick.source)}
                </span>
              </div>
            </div>
          </div>
          <ConfidenceBadge level={pick.confidence} />
        </div>

        <div className="bg-zinc-800/50 rounded-xl px-3 py-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-y-2.5 gap-x-3">
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Price to buy</p>
              <p className="text-sm font-bold text-white tabular-nums leading-tight">
                ${fmt(pick.entry_low)} – ${fmt(pick.entry_high)}
              </p>
              <p className="text-[11px] text-zinc-500 tabular-nums">Current ${fmt(pick.current_price)}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">
                {targetCopy.targetHeading}
              </p>
              <p className={cn(
                'text-sm font-bold tabular-nums leading-tight',
                showTarget ? 'text-white' : 'text-zinc-500',
              )}>
                {showTarget ? formatTargetPrice(pick.target_mean) : TARGET_UNAVAILABLE}
              </p>
              {subline && <p className="text-[11px] text-zinc-500">{subline}</p>}
              {showAnalystRange && (
                <p className="text-[10px] text-zinc-600 tabular-nums mt-0.5">
                  Range ${fmt(pick.target_low!)} – ${fmt(pick.target_high!)}
                </p>
              )}
            </div>
            <div>
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Room to grow</p>
              <p className={cn(
                'text-sm font-bold tabular-nums leading-tight',
                upsidePct == null ? 'text-zinc-500' : isPos ? 'text-emerald-400' : 'text-red-400',
              )}>
                {formatUpsidePct(upsidePct)}
              </p>
              <p className="text-[11px] text-zinc-500 tabular-nums">
                {showTarget
                  ? `${formatUpsideDollar(pick.target_mean, pick.current_price)} ${targetCopy.upsideSub}`
                  : TARGET_UNAVAILABLE}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Analyst views</p>
              <p className="text-sm font-bold text-white tabular-nums leading-tight">
                {pick.analyst_buy} say buy
              </p>
              <p className="text-[11px] text-zinc-500 tabular-nums">
                out of {pick.analyst_total}
              </p>
            </div>
          </div>

          <MomentumStrip pick={pick} />

          {(pick.volume_ratio != null && pick.volume_ratio >= 1.3) && (
            <div className="flex items-center gap-2 text-[11px]">
              <BarChart3 className="w-3.5 h-3.5 text-amber-400 shrink-0" aria-hidden="true" />
              <span className="text-zinc-400">
                Trading volume is{' '}
                <span className="text-amber-300 font-semibold tabular-nums">
                  {pick.volume_ratio.toFixed(1)}×
                </span>
                {' '}the usual daily average
              </span>
            </div>
          )}

          <Week52Range
            high={pick.week52_high}
            low={pick.week52_low}
            current={pick.current_price}
          />
        </div>

        <div className="mt-3">
          <VsSectorPanel pick={pick} />
        </div>

        {pick.ownership && (
          <div className="flex items-center gap-1.5 mt-2.5">
            <Briefcase className="w-3.5 h-3.5 text-zinc-500" aria-hidden="true" />
            <p className="text-[11px] text-zinc-400">
              You own <span className="text-zinc-200 font-semibold tabular-nums">{fmt(pick.ownership.shares, 0)}</span> shares
              <span className="text-zinc-600"> · paid avg ${fmt(pick.ownership.avg_cost_basis)}</span>
            </p>
          </div>
        )}

        {pick.factors.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {pick.factors.slice(0, 5).map((f, i) => (
              <FactorChip key={i} factor={f} />
            ))}
            {pick.factors.length > 5 && (
              <span className="text-[11px] text-zinc-600 self-center">+{pick.factors.length - 5} more</span>
            )}
          </div>
        )}

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/[0.04]">
          <span className="text-[11px] text-zinc-500 font-medium">
            {open ? 'Hide details' : 'See why we picked this'}
          </span>
          <CollapseChevron open={open} className="text-zinc-600" />
        </div>
      </button>

      {open && (
        <div className="px-3.5 pb-4 pt-1 space-y-4">
          <div>
            <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">
              What analysts say ({pick.analyst_total})
            </p>
            <div className="flex gap-2">
              <Mini label="Buy" value={pick.analyst_buy} tone="emerald" />
              <Mini label="Hold" value={pick.analyst_hold} tone="zinc" />
              <Mini label="Sell" value={pick.analyst_sell} tone="red" />
            </div>
          </div>

          {pick.thesis && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wide">Why it looks good</p>
              </div>
              <p className="text-sm text-zinc-200 leading-relaxed">{pick.thesis}</p>
            </div>
          )}

          {pick.main_risk && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
                <p className="text-[11px] font-bold text-yellow-400 uppercase tracking-wide">Main thing to watch</p>
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">{pick.main_risk}</p>
            </div>
          )}

          {pick.factors.length > 5 && (
            <div>
              <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">
                All signals
              </p>
              <div className="flex flex-wrap gap-1.5">
                {pick.factors.map((f, i) => (
                  <FactorChip key={i} factor={f} />
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-zinc-600 pt-1">
            {pick.narrative_source === 'llm'
              ? 'Summary written by AI · prices and ratings from public data'
              : 'Summary from the signals above · prices and ratings from public data'}
            {pick.narrative_generated_at && (
              <span className="block mt-0.5">
                Summary from {timeAgo(pick.narrative_generated_at)}
              </span>
            )}
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

function PickSection({
  title,
  subtitle,
  icon: Icon,
  picks,
  emptyMessage,
  collapsible = false,
  storageKey,
  defaultOpen = true,
  hideSubtitle = false,
}: {
  title: string
  subtitle: string
  icon: typeof Eye
  picks: Pick[]
  emptyMessage: string
  collapsible?: boolean
  storageKey?: string
  defaultOpen?: boolean
  hideSubtitle?: boolean
}) {
  const [open, setOpen] = useState(() => {
    if (!collapsible || !storageKey || typeof window === 'undefined') return defaultOpen
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved === '0') return false
      if (saved === '1') return true
    } catch {
      /* ignore */
    }
    return defaultOpen
  })

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, next ? '1' : '0')
        } catch {
          /* ignore */
        }
      }
      return next
    })
  }, [storageKey])

  const sectionId = `picks-section-${title.replace(/\s+/g, '-').toLowerCase()}`

  if (!picks.length) {
    return (
      <section className="mb-5" aria-labelledby={sectionId}>
        <SectionHeader
          id={sectionId}
          title={title}
          subtitle={subtitle}
          icon={Icon}
          collapsible={collapsible}
          open={open}
          onToggle={toggle}
          count={0}
          hideSubtitle={hideSubtitle}
        />
        {(!collapsible || open) && (
          <p className="text-sm text-zinc-500 text-center py-8 px-4 rounded-2xl bg-zinc-900/50 border border-white/[0.04]">
            {emptyMessage}
          </p>
        )}
      </section>
    )
  }

  return (
    <section className="mb-5" aria-labelledby={sectionId}>
      <SectionHeader
        id={sectionId}
        title={title}
        subtitle={subtitle}
        icon={Icon}
        collapsible={collapsible}
        open={open}
        onToggle={toggle}
        count={picks.length}
        hideSubtitle={hideSubtitle}
      />
      {(!collapsible || open) && (
        <ul id={`${sectionId}-list`} className="space-y-3 mt-2">
          {picks.map((p, i) => (
            <li key={`${p.ticker}-${p.source}`}>
              <PickCard pick={p} rank={i + 1} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function SectionHeader({
  id,
  title,
  subtitle,
  icon: Icon,
  collapsible = false,
  open = true,
  onToggle,
  count,
  hideSubtitle = false,
}: {
  id: string
  title: string
  subtitle: string
  icon: typeof Eye
  collapsible?: boolean
  open?: boolean
  onToggle?: () => void
  count?: number
  hideSubtitle?: boolean
}) {
  const showCollapsedHint = collapsible && !open
  const showSubtitle =
    showCollapsedHint ||
    (!hideSubtitle && (collapsible ? open && Boolean(subtitle) : Boolean(subtitle)))
  const subtitleText =
    collapsible && !open
      ? `${count ?? 0} pick${count === 1 ? '' : 's'} · tap to expand`
      : subtitle

  const inner = (
    <>
      <div className={cn('flex items-center gap-2 min-w-0', showSubtitle && 'mb-0.5')}>
        <Icon className="w-3.5 h-3.5 text-blue-400 shrink-0" aria-hidden="true" />
        <h2 id={id} className="text-sm font-bold text-white truncate">
          {title}
        </h2>
        {count != null && count > 0 && (
          <span className="shrink-0 text-[10px] font-semibold tabular-nums text-zinc-500 bg-zinc-800/80 px-1.5 py-0.5 rounded-full">
            {count}
          </span>
        )}
      </div>
      {showSubtitle && (
        <p className={cn('text-xs text-zinc-600 leading-snug', collapsible && 'text-left')}>
          {subtitleText}
        </p>
      )}
    </>
  )

  if (!collapsible) {
    return <div className="mb-2">{inner}</div>
  }

  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={`${id}-list`}
      onClick={onToggle}
      className={cn(
        'w-full text-left mb-1 rounded-xl -mx-1 px-1 py-0.5 min-h-[40px]',
        'active:bg-zinc-800/40 transition-colors [touch-action:manipulation]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">{inner}</div>
        <CollapseChevron open={open} className="mt-0.5" />
      </div>
    </button>
  )
}

export default function PicksPage() {
  const marketOpen = useMarketOpen()
  const { data, isLoading, isValidating, mutate } = useSWR<PicksResponse>('/api/picks', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 0,
    refreshInterval: (latest) => {
      const all = [...(latest?.your_picks ?? []), ...(latest?.discovery_picks ?? [])]
      if (!latest?.llm_enabled || !all.length) return 0
      const pendingLlm = all.some((p) => p.narrative_source === 'mechanical')
      return pendingLlm ? 15_000 : 0
    },
  })
  const [manualRefresh, setManualRefresh] = useState(false)

  const handleRefresh = useCallback(async () => {
    if (!marketOpen) return
    setManualRefresh(true)
    try {
      const fresh = await fetch('/api/picks?refresh=1', { cache: 'no-store' })
      if (!fresh.ok) throw new Error('refresh failed')
      const json = (await fresh.json()) as PicksResponse
      scoresFingerprintRef.current = allPicksFingerprint(json)
      stableScoresAtRef.current = json.scores_at
      await mutate(json, { revalidate: false })
    } catch {
      await mutate(undefined, { revalidate: true })
    } finally {
      setManualRefresh(false)
    }
  }, [marketOpen, mutate])

  const refreshing = manualRefresh || (isValidating && !isLoading)
  const hasAnyPicks = Boolean(data?.your_picks.length || data?.discovery_picks.length)

  return (
    <div className="min-h-screen bg-zinc-950">
      <AppNav onRefresh={handleRefresh} refreshing={refreshing} marketOpen={marketOpen} showRefresh />

      <main id="main" className="page-shell !pt-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-xl font-bold text-white tracking-tight">Picks</h1>
            <Sparkles className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
          </div>
          {data?.scores_at && !isLoading && (
            <p className="text-[11px] text-zinc-500 tabular-nums shrink-0">
              Updated {timeAgo(data.scores_at)}
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-[240px] rounded-2xl bg-zinc-900 animate-pulse" style={{ animationDelay: `${n * 80}ms` }} />
            ))}
          </div>
        ) : !data ? (
          <p className="text-zinc-500 text-sm text-center py-16">Failed to load picks. Try refreshing.</p>
        ) : !hasAnyPicks ? (
          <div className="text-center py-24">
            <div className="w-16 h-16 rounded-3xl bg-zinc-900 flex items-center justify-center mx-auto mb-5">
              <Sparkles className="w-7 h-7 text-zinc-700" aria-hidden="true" />
            </div>
            <p className="text-white text-base font-semibold mb-1">No picks right now</p>
            <p className="text-zinc-500 text-sm max-w-[280px] mx-auto [text-wrap:pretty]">
              None of your stocks match our buy checklist today. Check again after the market moves.
            </p>
          </div>
        ) : (
          <>
            <PickSection
              title="Your stocks"
              subtitle=""
              icon={Eye}
              picks={data.your_picks}
              emptyMessage="None of your watchlist or portfolio stocks qualify as a buy today."
              collapsible
              storageKey="picks_your_stocks_open"
              defaultOpen
              hideSubtitle
            />

            <PickSection
              title="Strong movers"
              subtitle="Quality-filtered ideas not on your watchlist or portfolio"
              icon={Compass}
              picks={data.discovery_picks}
              emptyMessage="No strong movers qualify today. Market data may still be loading — check back in a moment."
              collapsible
              storageKey="picks_discovery_open"
              defaultOpen
            />

            <div className="mt-2 flex items-start gap-2 px-1">
              <ShieldCheck className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-[11px] text-zinc-600 leading-relaxed">
                Not financial advice. Price targets are estimates to help you compare — not promises.
                Always do your own research before buying.
              </p>
            </div>
          </>
        )}
      </main>
    </div>
  )
}
