'use client'

import useSWR from 'swr'
import { useCallback, useState, type ReactNode } from 'react'
import AppNav from '@/components/AppNav'
import AnalystMiniGrid from '@/components/AnalystMiniGrid'
import RecentMovesPanel, { recentMovesCollapsedPreview } from '@/components/RecentMovesPanel'
import VsSectorPanel, { vsSectorCollapsedPreview } from '@/components/VsSectorPanel'
import { useMarketOpen, useMarketSession } from '@/hooks/useMarketOpen'
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
  Target,
  Activity,
} from 'lucide-react'
import StockLogo from '@/components/StockLogo'
import Week52Range from '@/components/Week52Range'
import { pickDisplayCopy } from '@/lib/picks'
import { isBenchmarkableSector, normalizeWatchlistSector } from '@/lib/sector-relative-strength-scoring'
import {
  formatTargetPrice,
  formatUpsidePct,
  hasDisplayTargetFromPickLabel,
  TARGET_UNAVAILABLE,
} from '@/lib/target-price-display'
import { cn } from '@/lib/utils'
import type { Pick, PicksResponse, PickFactor, PickSourceTag, SectorBenchmark } from '@/types'
import type { MarketSession } from '@/lib/market-hours'

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

function sectorBenchmarkForPick(
  pick: Pick,
  benchmarks: Record<string, SectorBenchmark>,
): SectorBenchmark | null {
  const sector = pick.sector?.trim()
  if (!sector || sector === 'Other') return null
  return benchmarks[sector] ?? null
}

function truncatePreview(text: string, max = 72): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).trim()}…`
}

type PickAccordionKey = 'price' | 'momentum' | 'sector' | 'why'

const PICK_SECTIONS_CLOSED: Record<PickAccordionKey, boolean> = {
  price: false,
  momentum: false,
  sector: false,
  why: false,
}

function pricePreview(pick: Pick, showTarget: boolean, targetCopy: ReturnType<typeof pickDisplayCopy>): string {
  const buy = `Buy $${fmt(pick.entry_low)}–$${fmt(pick.entry_high)}`
  if (!showTarget) return buy
  const target = formatTargetPrice(pick.target_mean)
  const extra = targetCopy.targetSub ? ` · ${targetCopy.targetSub}` : ''
  return `${buy} · Target ${target}${extra}`
}

function momentumPreview(pick: Pick): string {
  return recentMovesCollapsedPreview({
    change1d: pick.change_1d_pct,
    change7d: pick.change_7d_pct,
    change30d: pick.change_30d_pct,
    volumeRatio: pick.volume_ratio,
  })
}

function sectorPreview(pick: Pick): string | null {
  return vsSectorCollapsedPreview(pick.vs_sector, pick.sector)
}

function whyPreview(pick: Pick): string {
  if (pick.thesis) return truncatePreview(pick.thesis)
  const top = pick.factors.find((f) => f.tone === 'positive')
  if (top) return truncatePreview(top.label)
  return 'Signals and summary'
}

function PickAccordionRow({
  id,
  label,
  preview,
  open,
  onToggle,
  icon: Icon,
  children,
}: {
  id: string
  label: string
  preview: string
  open: boolean
  onToggle: () => void
  icon: typeof Target
  children: ReactNode
}) {
  return (
    <div className="border-t border-white/[0.04]">
      <button
        type="button"
        id={`${id}-trigger`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={onToggle}
        className={cn(
          'w-full text-left px-3.5 py-3 min-h-[48px]',
          'active:bg-zinc-800/50 transition-colors [touch-action:manipulation]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Icon className="w-3.5 h-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-semibold text-zinc-300">{label}</span>
            </div>
            {!open && (
              <p className="text-[11px] text-zinc-600 mt-1 leading-snug truncate">{preview}</p>
            )}
          </div>
          <CollapseChevron open={open} className="text-zinc-600 shrink-0 mt-0.5" />
        </div>
      </button>
      {open && (
        <div id={`${id}-panel`} role="region" aria-labelledby={`${id}-trigger`} className="px-3.5 pb-3.5 pt-0">
          {children}
        </div>
      )}
    </div>
  )
}

function PickCard({
  pick,
  rank,
  llmEnabled,
  marketSession,
  sectorBenchmarks,
}: {
  pick: Pick
  rank: number
  llmEnabled?: boolean
  marketSession: MarketSession
  sectorBenchmarks: Record<string, SectorBenchmark>
}) {
  const cardId = `pick-${pick.ticker}-${pick.source}`

  const [sections, setSections] = useState<Record<PickAccordionKey, boolean>>(() => ({ ...PICK_SECTIONS_CLOSED }))

  const toggleSection = useCallback((key: PickAccordionKey) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

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
  const sectorPreviewText = sectorPreview(pick)
  const sectorLabel = pick.vs_sector?.sector ?? normalizeWatchlistSector(pick.sector)
  const hasSector = sectorLabel !== 'Other' && isBenchmarkableSector(sectorLabel)

  return (
    <div className="card-surface overflow-hidden">
      <div className="px-3.5 pt-4 pb-3">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <span className="text-[11px] font-bold text-zinc-500 tabular-nums w-5 shrink-0">#{rank}</span>
            <StockLogo ticker={pick.ticker} size="sm" inset />
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

        <div className="grid grid-cols-3 gap-2 rounded-xl bg-zinc-800/50 px-2 py-2.5">
          <div>
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Price to buy</p>
            <p className="text-sm font-bold text-white tabular-nums leading-tight">
              ${fmt(pick.entry_low)} – ${fmt(pick.entry_high)}
            </p>
            <p className="text-[10px] text-zinc-600 tabular-nums">Current ${fmt(pick.current_price)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Room to grow</p>
            <p className={cn(
              'text-sm font-bold tabular-nums leading-tight',
              upsidePct == null ? 'text-zinc-500' : isPos ? 'text-emerald-400' : 'text-red-400',
            )}>
              {formatUpsidePct(upsidePct)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Analysts</p>
            <p className="text-sm font-bold text-white tabular-nums leading-tight">
              {pick.analyst_buy} buy
            </p>
            <p className="text-[10px] text-zinc-600 tabular-nums">of {pick.analyst_total}</p>
          </div>
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
      </div>

      <PickAccordionRow
        id={`${cardId}-price`}
        label="Price & targets"
        preview={pricePreview(pick, showTarget, targetCopy)}
        open={sections.price}
        onToggle={() => toggleSection('price')}
        icon={Target}
      >
        <div className="space-y-3 rounded-xl bg-zinc-900/60 border border-white/[0.04] px-3 py-3">
          <div className="grid grid-cols-2 gap-3">
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
          </div>
          <Week52Range
            high={pick.week52_high}
            low={pick.week52_low}
            current={pick.current_price}
          />
        </div>
      </PickAccordionRow>

      <PickAccordionRow
        id={`${cardId}-momentum`}
        label="Recent moves"
        preview={momentumPreview(pick)}
        open={sections.momentum}
        onToggle={() => toggleSection('momentum')}
        icon={Activity}
      >
        <RecentMovesPanel
          change7d={pick.change_7d_pct}
          change14d={pick.change_14d_pct}
          change30d={pick.change_30d_pct}
          volumeRatio={pick.volume_ratio}
        />
      </PickAccordionRow>

      {hasSector && sectorPreviewText && (
        <PickAccordionRow
          id={`${cardId}-sector`}
          label="Vs sector"
          preview={sectorPreviewText}
          open={sections.sector}
          onToggle={() => toggleSection('sector')}
          icon={BarChart3}
        >
          <VsSectorPanel
            vsSector={pick.vs_sector}
            sectorBenchmark={sectorBenchmarkForPick(pick, sectorBenchmarks)}
            stockSector={pick.sector}
            regularChange1dPct={pick.change_1d_pct}
            stockChange1d={pick.change_1d_pct}
            snapshotSession={pick.change_1d_session}
            marketSession={marketSession}
          />
        </PickAccordionRow>
      )}

      <PickAccordionRow
        id={`${cardId}-why`}
        label="Why we picked this"
        preview={whyPreview(pick)}
        open={sections.why}
        onToggle={() => toggleSection('why')}
        icon={Eye}
      >
        <div className="space-y-4">
          {pick.factors.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pick.factors.map((f, i) => (
                <FactorChip key={i} factor={f} />
              ))}
            </div>
          )}

          <AnalystMiniGrid
            buy={pick.analyst_buy}
            hold={pick.analyst_hold}
            sell={pick.analyst_sell}
            total={pick.analyst_total}
          />

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

          <p className="text-[10px] text-zinc-600 pt-1">
            {pick.narrative_source === 'llm'
              ? 'Summary written by AI · prices and ratings from public data'
              : llmEnabled
                ? 'Signal-based summary · AI unavailable right now'
                : 'Summary from the signals above · prices and ratings from public data'}
            {pick.narrative_generated_at && (
              <span className="block mt-0.5">
                Summary from {timeAgo(pick.narrative_generated_at)}
              </span>
            )}
          </p>
        </div>
      </PickAccordionRow>
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
  llmEnabled = false,
  marketSession,
  sectorBenchmarks,
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
  llmEnabled?: boolean
  marketSession: MarketSession
  sectorBenchmarks: Record<string, SectorBenchmark>
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
              <PickCard
                pick={p}
                rank={i + 1}
                llmEnabled={llmEnabled}
                marketSession={marketSession}
                sectorBenchmarks={sectorBenchmarks}
              />
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
  const marketSession = useMarketSession()
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
              llmEnabled={data.llm_enabled}
              marketSession={marketSession}
              sectorBenchmarks={data.sector_benchmarks ?? {}}
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
              llmEnabled={data.llm_enabled}
              marketSession={marketSession}
              sectorBenchmarks={data.sector_benchmarks ?? {}}
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
