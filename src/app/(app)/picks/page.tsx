'use client'

import useSWR from 'swr'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
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
  Newspaper,
} from 'lucide-react'
import NewsRow from '@/components/NewsRow'
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
    high: { label: 'High confidence', styles: 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/25' },
    medium: { label: 'Medium confidence', styles: 'bg-yellow-500/15 text-yellow-300 ring-1 ring-yellow-500/20' },
    low: { label: 'Low confidence', styles: 'bg-zinc-800/80 text-zinc-400 ring-1 ring-white/8' },
  }[level]
  return (
    <span
      aria-label={config.label}
      className={cn(
        'shrink-0 whitespace-nowrap type-micro font-bold uppercase tracking-wide',
        'px-2 py-0.5 rounded-full',
        config.styles,
      )}
    >
      {config.label}
    </span>
  )
}

function PickRankBadge({ rank }: { rank: number }) {
  const isTop = rank === 1
  return (
    <div
      className={cn(
        'w-10 h-10 rounded-xl flex flex-col items-center justify-center shrink-0',
        isTop
          ? 'bg-gradient-to-br from-amber-400/30 via-amber-500/15 to-orange-600/10 border border-amber-400/35 shadow-[0_0_16px_rgba(251,191,36,0.12)]'
          : rank <= 3
            ? 'bg-gradient-to-br from-violet-400/20 to-violet-600/5 border border-violet-400/25'
            : 'bg-zinc-800/90 border border-white/10',
      )}
      aria-hidden="true"
    >
      <Sparkles
        className={cn(
          'w-3 h-3 mb-0.5',
          isTop ? 'text-amber-300' : rank <= 3 ? 'text-violet-300/90' : 'text-zinc-500',
        )}
      />
      <span
        className={cn(
          'type-meta font-black tabular-nums leading-none',
          isTop ? 'text-amber-100' : rank <= 3 ? 'text-violet-100' : 'text-zinc-300',
        )}
      >
        {rank}
      </span>
    </div>
  )
}

type PickHeroContentProps = {
  pick: Pick
  rank: number
  upsidePct: number | null
  isPos: boolean
}

function PickOwnershipRow({ pick }: { pick: Pick }) {
  if (!pick.ownership) return null
  return (
    <div className="flex items-center gap-1.5 mt-3 px-2 py-2 rounded-lg bg-black/20 border border-white/[0.04]">
      <Briefcase className="w-3.5 h-3.5 shrink-0 text-amber-400/70" aria-hidden="true" />
      <p className="type-meta text-zinc-400">
        You own <span className="text-zinc-200 font-semibold tabular-nums">{fmt(pick.ownership.shares, 0)}</span> shares
        <span className="text-muted"> · paid avg ${fmt(pick.ownership.avg_cost_basis)}</span>
      </p>
    </div>
  )
}

function PickCardHeroStats({
  pick,
  upsidePct,
  isPos,
}: {
  pick: Pick
  upsidePct: number | null
  isPos: boolean
}) {
  return (
    <div className="pick-card-stats rounded-xl px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span className="type-micro font-bold uppercase tracking-wide text-blue-400/55 shrink-0">Buy</span>
        <span className="font-bold text-white tabular-nums">
          ${fmt(pick.entry_low)} – ${fmt(pick.entry_high)}
        </span>
        <span className="text-muted">·</span>
        <span className="type-meta text-zinc-500 tabular-nums">Now ${fmt(pick.current_price)}</span>
      </div>
      <div className="h-px bg-blue-500/10" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="type-micro font-bold uppercase tracking-wide text-blue-400/55">Room to grow</span>
          <span className={cn(
            'text-base font-black tabular-nums',
            upsidePct == null ? 'text-zinc-500' : isPos ? 'text-emerald-400' : 'text-red-400',
          )}>
            {formatUpsidePct(upsidePct)}
          </span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="type-micro font-bold uppercase tracking-wide text-blue-400/55">Analysts</span>
          <span className="text-sm font-bold text-white tabular-nums">
            {pick.analyst_buy} buy
          </span>
          <span className="type-meta text-zinc-500 tabular-nums">/ {pick.analyst_total}</span>
        </div>
      </div>
    </div>
  )
}

function PickCardHero({ pick, rank, upsidePct, isPos }: PickHeroContentProps) {
  return (
    <div className="pick-card-hero px-4 pt-5 pb-3.5">
      <Sparkles
        className="absolute right-3 top-8 w-16 h-16 text-amber-400/[0.04] pointer-events-none"
        aria-hidden="true"
      />

      <div className="relative flex items-start gap-2.5 sm:gap-3 mb-3">
        <PickRankBadge rank={rank} />
        <StockLogo ticker={pick.ticker} size="md" inset />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-1.5 min-w-0 flex-wrap">
              <span className="text-lg font-bold text-white tracking-tight" translate="no">
                {pick.ticker}
              </span>
              {rank === 1 && (
                <span className="type-micro font-bold uppercase tracking-wide text-amber-300/90 shrink-0">
                  Top pick
                </span>
              )}
            </div>
            <ConfidenceBadge level={pick.confidence} />
          </div>
          <p className="text-sm text-zinc-400 leading-snug line-clamp-2 mt-0.5 [text-wrap:pretty]">
            {pick.company_name}
          </p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {pick.sector && pick.sector !== 'Other' && (
              <span className="type-meta text-zinc-500">{pick.sector}</span>
            )}
            <span className={cn('type-micro font-bold uppercase tracking-wide px-2 py-0.5 rounded-full', sourceStyles(pick.source))}>
              {sourceLabel(pick.source)}
            </span>
          </div>
        </div>
      </div>

      <PickCardHeroStats pick={pick} upsidePct={upsidePct} isPos={isPos} />
      <PickOwnershipRow pick={pick} />
    </div>
  )
}

function FactorChip({ factor }: { factor: PickFactor }) {
  const tone =
    factor.tone === 'positive' ? 'bg-emerald-500/10 text-emerald-300' :
    factor.tone === 'negative' ? 'bg-red-500/10 text-red-300' :
    'bg-zinc-800 text-zinc-400'
  return (
    <span className={cn('text-sm sm:text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap', tone)}>
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

type PickAccordionKey = 'price' | 'momentum' | 'sector' | 'headlines' | 'why'

const PICK_SECTIONS_CLOSED: Record<PickAccordionKey, boolean> = {
  price: false,
  momentum: false,
  sector: false,
  headlines: false,
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

function headlinesPreview(pick: Pick): string {
  const top = pick.news?.[0]
  if (top) return truncatePreview(top.title)
  return 'No headlines right now'
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
              <span className="type-meta font-semibold text-zinc-300">{label}</span>
            </div>
            {!open && (
              <p className="type-meta text-muted-preview mt-1 leading-snug truncate">{preview}</p>
            )}
          </div>
          <CollapseChevron open={open} className="text-muted shrink-0 mt-0.5" />
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
    <div
      className={cn(
        'pick-card overflow-hidden',
        rank === 1 && 'pick-card--top',
        rank >= 2 && rank <= 3 && 'pick-card--ranked',
      )}
    >
      <PickCardHero
        pick={pick}
        rank={rank}
        upsidePct={upsidePct}
        isPos={isPos}
      />

      <div className="border-t border-amber-500/10 bg-zinc-950/35">
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
              <p className="type-micro font-semibold text-zinc-500 uppercase tracking-wide">Price to buy</p>
              <p className="text-sm font-bold text-white tabular-nums leading-tight">
                ${fmt(pick.entry_low)} – ${fmt(pick.entry_high)}
              </p>
              <p className="type-meta text-zinc-500 tabular-nums">Current ${fmt(pick.current_price)}</p>
            </div>
            <div className="text-right">
              <p className="type-micro font-semibold text-zinc-500 uppercase tracking-wide">
                {targetCopy.targetHeading}
              </p>
              <p className={cn(
                'text-sm font-bold tabular-nums leading-tight',
                showTarget ? 'text-white' : 'text-zinc-500',
              )}>
                {showTarget ? formatTargetPrice(pick.target_mean) : TARGET_UNAVAILABLE}
              </p>
              {subline && <p className="type-meta text-zinc-500">{subline}</p>}
              {showAnalystRange && (
                <p className="type-micro text-muted tabular-nums mt-0.5">
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
        id={`${cardId}-headlines`}
        label="Headlines"
        preview={headlinesPreview(pick)}
        open={sections.headlines}
        onToggle={() => toggleSection('headlines')}
        icon={Newspaper}
      >
        {pick.news?.length ? (
          <div className="space-y-2">
            {pick.news.map((n, i) => (
              <NewsRow key={i} item={n} />
            ))}
          </div>
        ) : (
          <p className="type-meta text-muted px-1 py-2">No headlines for this stock right now.</p>
        )}
      </PickAccordionRow>

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
                <p className="type-meta font-bold text-emerald-400 uppercase tracking-wide">Why it looks good</p>
              </div>
              <p className="text-sm text-zinc-200 leading-relaxed">{pick.thesis}</p>
            </div>
          )}

          {pick.main_risk && (
            <div>
              <div className="flex items-center gap-1.5 mb-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-yellow-400" aria-hidden="true" />
                <p className="type-meta font-bold text-yellow-400 uppercase tracking-wide">Main thing to watch</p>
              </div>
              <p className="text-sm text-zinc-300 leading-relaxed">{pick.main_risk}</p>
            </div>
          )}

          <p className="type-micro text-muted pt-1">
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
    </div>
  )
}

type PicksTab = 'discovery' | 'your'

const PICKS_TAB_STORAGE_KEY = 'picks_active_tab'

const PICKS_TABS: {
  id: PicksTab
  label: string
  shortLabel: string
  icon: typeof Compass
  subtitle?: string
}[] = [
  {
    id: 'discovery',
    label: 'Strong movers',
    shortLabel: 'Movers',
    icon: Compass,
    subtitle: 'Quality-filtered ideas not on your watchlist or portfolio',
  },
  {
    id: 'your',
    label: 'Your stocks',
    shortLabel: 'Yours',
    icon: Eye,
  },
]

function PicksTabBar({
  activeTab,
  onSelect,
  counts,
}: {
  activeTab: PicksTab
  onSelect: (tab: PicksTab) => void
  counts: Record<PicksTab, number>
}) {
  return (
    <div role="tablist" aria-label="Pick lists" className="flex border-b border-white/[0.06] mb-3">
      {PICKS_TABS.map(({ id, label, shortLabel, icon: Icon }) => {
        const isActive = activeTab === id
        const count = counts[id]
        return (
          <button
            key={id}
            type="button"
            role="tab"
            id={`picks-tab-${id}`}
            aria-selected={isActive}
            aria-controls={`picks-panel-${id}`}
            onClick={() => onSelect(id)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 min-h-[48px] px-2 pb-2.5 pt-1',
              'border-b-2 transition-colors [touch-action:manipulation]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40',
              isActive
                ? 'border-blue-400 text-white'
                : 'border-transparent text-zinc-500 active:text-zinc-300',
            )}
          >
            <Icon
              className={cn('w-3.5 h-3.5 shrink-0', isActive ? 'text-blue-400' : 'text-zinc-600')}
              aria-hidden="true"
            />
            <span className="text-xs font-bold truncate">
              <span className="sm:hidden">{shortLabel}</span>
              <span className="hidden sm:inline">{label}</span>
            </span>
            <span
              className={cn(
                'shrink-0 type-micro tabular-nums font-semibold px-1.5 py-px rounded-full',
                isActive ? 'bg-blue-500/15 text-blue-300' : 'bg-zinc-800/80 text-zinc-500',
              )}
            >
              {count}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function PickListPanel({
  panelId,
  labelledBy,
  picks,
  emptyMessage,
  llmEnabled,
  marketSession,
  sectorBenchmarks,
}: {
  panelId: string
  labelledBy: string
  picks: Pick[]
  emptyMessage: string
  llmEnabled: boolean
  marketSession: MarketSession
  sectorBenchmarks: Record<string, SectorBenchmark>
}) {
  if (!picks.length) {
    return (
      <div role="tabpanel" id={panelId} aria-labelledby={labelledBy}>
        <p className="text-sm text-zinc-500 text-center py-8 px-4 rounded-2xl bg-zinc-900/50 border border-white/[0.04]">
          {emptyMessage}
        </p>
      </div>
    )
  }

  return (
    <div role="tabpanel" id={panelId} aria-labelledby={labelledBy}>
      <ul className="space-y-3">
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
    </div>
  )
}

function PicksTabbedLists({
  data,
  marketSession,
}: {
  data: PicksResponse
  marketSession: MarketSession
}) {
  const [activeTab, setActiveTab] = useState<PicksTab>('discovery')
  const tabResolvedRef = useRef(false)
  const sectorBenchmarks = data.sector_benchmarks ?? {}

  useEffect(() => {
    if (tabResolvedRef.current) return
    tabResolvedRef.current = true
    try {
      const saved = localStorage.getItem(PICKS_TAB_STORAGE_KEY)
      if (saved === 'discovery' || saved === 'your') {
        setActiveTab(saved)
        return
      }
    } catch {
      /* ignore */
    }
    setActiveTab(data.discovery_picks.length > 0 ? 'discovery' : 'your')
  }, [data])

  const selectTab = useCallback((tab: PicksTab) => {
    setActiveTab(tab)
    try {
      localStorage.setItem(PICKS_TAB_STORAGE_KEY, tab)
    } catch {
      /* ignore */
    }
  }, [])

  const activeTabMeta = PICKS_TABS.find((t) => t.id === activeTab)
  const tabCounts: Record<PicksTab, number> = {
    discovery: data.discovery_picks.length,
    your: data.your_picks.length,
  }

  return (
    <section aria-label="Stock picks">
      <PicksTabBar activeTab={activeTab} onSelect={selectTab} counts={tabCounts} />

      {activeTabMeta?.subtitle && (
        <p className="type-caption text-muted leading-snug mb-3 px-1 border-l-2 border-blue-500/25 pl-2.5">
          {activeTabMeta.subtitle}
        </p>
      )}

      {activeTab === 'discovery' ? (
        <PickListPanel
          panelId="picks-panel-discovery"
          labelledBy="picks-tab-discovery"
          picks={data.discovery_picks}
          emptyMessage="No strong movers qualify today. Market data may still be loading — check back in a moment."
          llmEnabled={data.llm_enabled}
          marketSession={marketSession}
          sectorBenchmarks={sectorBenchmarks}
        />
      ) : (
        <PickListPanel
          panelId="picks-panel-your"
          labelledBy="picks-tab-your"
          picks={data.your_picks}
          emptyMessage="None of your watchlist or portfolio stocks qualify as a buy today."
          llmEnabled={data.llm_enabled}
          marketSession={marketSession}
          sectorBenchmarks={sectorBenchmarks}
        />
      )}

      <div className="mt-4 flex items-start gap-2 px-1">
        <ShieldCheck className="w-3.5 h-3.5 text-muted shrink-0 mt-0.5" aria-hidden="true" />
        <p className="type-meta text-muted leading-relaxed">
          Not financial advice. Price targets are estimates to help you compare — not promises.
          Always do your own research before buying.
        </p>
      </div>
    </section>
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
            <h1 className="text-2xl sm:text-xl font-bold text-white tracking-tight">Picks</h1>
            <Sparkles className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
          </div>
          {data?.scores_at && !isLoading && (
            <p className="type-meta text-zinc-500 tabular-nums shrink-0">
              Updated {timeAgo(data.scores_at)}
            </p>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            {[1, 2, 3].map((n) => (
              <div key={n} className="pick-card h-[260px] animate-pulse opacity-60" style={{ animationDelay: `${n * 80}ms` }} />
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
          <PicksTabbedLists data={data} marketSession={marketSession} />
        )}
      </main>
    </div>
  )
}
