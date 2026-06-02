'use client'

import useSWR from 'swr'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import AppNav from '@/components/AppNav'
import PicksLoadingState from '@/components/picks/PicksLoadingState'
import { PicksRefreshProvider } from '@/contexts/picks-refresh'
import AnalystMiniGrid from '@/components/AnalystMiniGrid'
import PriceChartPanel from '@/components/PriceChartPanel'
import StockResearchPanel from '@/components/StockResearchPanel'
import VsSectorPanel from '@/components/VsSectorPanel'
import {
  Sparkles,
  TrendingUp,
  AlertTriangle,
  ShieldCheck,
  Briefcase,
  Eye,
  BarChart3,
  Target,
  Activity,
  Newspaper,
  Gauge,
} from 'lucide-react'
import { useMarketSession } from '@/hooks/useMarketOpen'
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
import type {
  Pick,
  PickHeadlinesResponse,
  PickNarrativePayload,
  PickNarrativesResponse,
  PicksResponse,
  PickFactor,
  SectorBenchmark,
  SignalNewsItem,
} from '@/types'
import type { MarketSession } from '@/lib/market-hours'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load picks')
  return res.json() as Promise<T>
}

function mergePickNarratives(picks: Pick[], narratives: Record<string, PickNarrativePayload>): Pick[] {
  if (!Object.keys(narratives).length) return picks
  return picks.map((pick) => {
    const narrative = narratives[pick.ticker.toUpperCase()]
    if (!narrative) return pick
    return {
      ...pick,
      company_blurb: narrative.company_blurb ?? pick.company_blurb,
      thesis: narrative.thesis,
      main_risk: narrative.main_risk,
      narrative_source: narrative.narrative_source,
      narrative_generated_at: narrative.narrative_generated_at,
    }
  })
}

function mergePickHeadlines(picks: Pick[], headlines: Record<string, SignalNewsItem[]>): Pick[] {
  if (!Object.keys(headlines).length) return picks
  return picks.map((pick) => ({
    ...pick,
    news: headlines[pick.ticker.toUpperCase()] ?? pick.news ?? [],
  }))
}

const narrativesFetcher = (url: string) => fetchJson<PickNarrativesResponse>(url)
const headlinesFetcher = (url: string) => fetchJson<PickHeadlinesResponse>(url)

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

function PickOwnershipRow({ pick }: { pick: Pick }) {
  if (!pick.ownership) return null
  const pnlPct =
    pick.ownership.avg_cost_basis > 0
      ? ((pick.current_price - pick.ownership.avg_cost_basis) / pick.ownership.avg_cost_basis) * 100
      : null
  return (
    <div className="flex items-center gap-1.5 mt-3 px-2 py-2 rounded-lg bg-black/20 border border-white/[0.04]">
      <Briefcase className="w-3.5 h-3.5 shrink-0 text-amber-400/70" aria-hidden="true" />
      <p className="type-meta text-zinc-400">
        Your position:{' '}
        <span className="text-zinc-200 font-semibold tabular-nums">{fmt(pick.ownership.shares, 0)}</span> shares
        <span className="text-muted"> · avg ${fmt(pick.ownership.avg_cost_basis)}</span>
        <span className="text-muted"> · </span>
        <span className="text-zinc-200 font-semibold tabular-nums">${fmt(pick.ownership.current_value, 0)}</span>
        <span className="text-muted"> at ${fmt(pick.current_price)}</span>
        {pnlPct != null ? (
          <span className={cn('font-semibold tabular-nums', pnlPct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {' '}
            ({pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%)
          </span>
        ) : null}
      </p>
    </div>
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
          <p className="text-sm text-zinc-400 leading-snug line-clamp-2 mt-0.5 [text-wrap:pretty]">
            {pick.company_name}
          </p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {pick.sector && pick.sector !== 'Other' && (
              <span className="type-meta text-zinc-500">{pick.sector}</span>
            )}
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

type PickAccordionKey = 'price' | 'momentum' | 'research' | 'sector' | 'headlines' | 'why'

type PickSectionTab = {
  key: PickAccordionKey
  label: string
  shortLabel: string
  icon: typeof Target
}

function PickSectionTabs({
  cardId,
  tabs,
  active,
  onSelect,
  panel,
}: {
  cardId: string
  tabs: PickSectionTab[]
  active: PickAccordionKey | null
  onSelect: (key: PickAccordionKey) => void
  panel: ReactNode
}) {
  return (
    <div className="border-t border-white/[0.04]">
      <div className="px-2 py-2" role="tablist" aria-label="Pick details">
        <div className="flex items-stretch gap-0.5">
          {tabs.map(({ key, shortLabel, label, icon: Icon }) => {
            const selected = active === key
            return (
              <button
                key={key}
                type="button"
                role="tab"
                id={`${cardId}-tab-${key}`}
                aria-selected={selected}
                aria-controls={`${cardId}-panel-${key}`}
                aria-label={label}
                onClick={() => onSelect(key)}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-0.5 min-w-0 py-2 px-0.5 rounded-xl',
                  '[touch-action:manipulation] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
                  selected
                    ? 'bg-blue-500/15 text-blue-300'
                    : 'text-zinc-400 active:bg-zinc-800/80',
                )}
              >
                <Icon
                  className={cn('w-4 h-4 shrink-0', selected ? 'text-blue-400' : 'text-zinc-400')}
                  aria-hidden="true"
                />
                <span className="text-[10px] font-semibold leading-none truncate max-w-full">
                  {shortLabel}
                </span>
              </button>
            )
          })}
        </div>
      </div>
      {active && (
        <div
          role="tabpanel"
          id={`${cardId}-panel-${active}`}
          aria-labelledby={`${cardId}-tab-${active}`}
          className="px-3.5 pb-3.5 pt-2 border-t border-white/[0.04]"
        >
          {panel}
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
  const cardId = `pick-${pick.ticker}`

  const [activeSection, setActiveSection] = useState<PickAccordionKey | null>(null)

  const selectSection = useCallback((key: PickAccordionKey) => {
    setActiveSection((prev) => (prev === key ? null : key))
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
  const sectorLabel = pick.vs_sector?.sector ?? normalizeWatchlistSector(pick.sector)
  const hasSector = sectorLabel !== 'Other' && isBenchmarkableSector(sectorLabel)

  const sectionTabs = useMemo(() => {
    const tabs: PickSectionTab[] = [
      { key: 'price', label: 'Price & targets', shortLabel: 'Price', icon: Target },
      { key: 'momentum', label: 'Price chart', shortLabel: 'Chart', icon: Activity },
      { key: 'research', label: 'Key research', shortLabel: 'Research', icon: Gauge },
    ]
    if (hasSector) {
      tabs.push({ key: 'sector', label: 'Vs sector', shortLabel: 'Sector', icon: BarChart3 })
    }
    tabs.push(
      { key: 'headlines', label: 'Headlines', shortLabel: 'News', icon: Newspaper },
      { key: 'why', label: 'Why we picked this', shortLabel: 'Why', icon: Eye },
    )
    return tabs
  }, [hasSector])

  useEffect(() => {
    if (activeSection && !sectionTabs.some((tab) => tab.key === activeSection)) {
      setActiveSection(null)
    }
  }, [activeSection, sectionTabs])

  const sectionPanel = useMemo(() => {
    switch (activeSection) {
      case 'price':
        return (
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
        )
      case 'momentum':
        return <PriceChartPanel ticker={pick.ticker} volumeRatio={pick.volume_ratio} />
      case 'research':
        return <StockResearchPanel ticker={pick.ticker} />
      case 'sector':
        return (
          <VsSectorPanel
            vsSector={pick.vs_sector}
            sectorBenchmark={sectorBenchmarkForPick(pick, sectorBenchmarks)}
            stockSector={pick.sector}
            regularChange1dPct={pick.change_1d_pct}
            stockChange1d={pick.change_1d_pct}
            snapshotSession={pick.change_1d_session}
            marketSession={marketSession}
          />
        )
      case 'headlines':
        return pick.news?.length ? (
          <div className="space-y-2">
            {pick.news.map((n, i) => (
              <NewsRow key={i} item={n} />
            ))}
          </div>
        ) : (
          <p className="type-meta text-muted px-1 py-2">No headlines for this stock right now.</p>
        )
      case 'why':
        return (
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

            {pick.company_blurb && (
              <div>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-blue-400" aria-hidden="true" />
                  <p className="type-meta font-bold text-blue-400 uppercase tracking-wide">What they do</p>
                </div>
                <p className="text-sm text-zinc-300 leading-relaxed">{pick.company_blurb}</p>
              </div>
            )}

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
                  ? 'Signal-based summary · AI summary loading…'
                  : 'Summary from the signals above · prices and ratings from public data'}
              {pick.narrative_generated_at && (
                <span className="block mt-0.5">
                  Summary from {timeAgo(pick.narrative_generated_at)}
                </span>
              )}
            </p>
          </div>
        )
      default:
        return null
    }
  }, [
    activeSection,
    llmEnabled,
    marketSession,
    pick,
    sectorBenchmarks,
    showAnalystRange,
    showTarget,
    subline,
    targetCopy.targetHeading,
  ])

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
        <PickSectionTabs
          cardId={cardId}
          tabs={sectionTabs}
          active={activeSection}
          onSelect={selectSection}
          panel={sectionPanel}
        />
      </div>
    </div>
  )
}

function PicksRankedList({
  data,
  marketSession,
  loading,
}: {
  data: PicksResponse
  marketSession: MarketSession
  loading?: boolean
}) {
  const sectorBenchmarks = data.sector_benchmarks ?? {}

  const rankByTicker = useMemo(
    () => new Map(data.picks.map((p, i) => [p.ticker, i + 1])),
    [data.picks],
  )

  if (loading) {
    return (
      <section aria-label="Stock picks">
        <PicksLoadingState />
      </section>
    )
  }

  if (!data.picks.length) {
    return (
      <section aria-label="Stock picks">
        <div className="text-center py-24">
          <div className="w-16 h-16 rounded-3xl bg-zinc-900 flex items-center justify-center mx-auto mb-5">
            <Sparkles className="w-7 h-7 text-zinc-700" aria-hidden="true" />
          </div>
          <p className="text-white text-base font-semibold mb-1">No picks right now</p>
          <p className="text-zinc-500 text-sm max-w-[280px] mx-auto [text-wrap:pretty]">
            No stocks met our quality bar in the latest run. Check back after the nightly refresh.
          </p>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Stock picks">
      <ul className="space-y-3">
        {data.picks.map((p) => (
          <li key={p.ticker}>
            <PickCard
              pick={p}
              rank={rankByTicker.get(p.ticker) ?? 1}
              llmEnabled={data.llm_enabled}
              marketSession={marketSession}
              sectorBenchmarks={sectorBenchmarks}
            />
          </li>
        ))}
      </ul>

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

const EMPTY_PICKS: PicksResponse = {
  picks: [],
  scores_at: '',
  generated_at: null,
  next_refresh_at: null,
  qualified_count: 0,
  stale: false,
  narratives_at: null,
  llm_enabled: false,
  sector_benchmarks: {},
}

export default function PicksPage() {
  const marketSession = useMarketSession()
  const [isRefreshing, setIsRefreshing] = useState(false)
  const { data, isLoading, error, mutate } = useSWR<PicksResponse>('/api/picks', fetchJson, {
    revalidateOnFocus: false,
    dedupingInterval: 0,
  })

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true)
    try {
      await mutate(fetchJson('/api/picks'), { revalidate: false })
    } finally {
      setIsRefreshing(false)
    }
  }, [mutate])

  const picksRefreshValue = useMemo(
    () => ({ refresh: handleRefresh, refreshing: isRefreshing }),
    [handleRefresh, isRefreshing],
  )

  const headlineTickers = useMemo(() => {
    if (!data?.picks.length) return ''
    return [...new Set(data.picks.map((p) => p.ticker.toUpperCase()))].join(',')
  }, [data])

  const { data: headlineData } = useSWR<PickHeadlinesResponse>(
    headlineTickers ? `/api/picks/headlines?tickers=${headlineTickers}` : null,
    headlinesFetcher,
    { revalidateOnFocus: false, dedupingInterval: 0 },
  )

  const pendingNarrativeTickers = useMemo(() => {
    if (!data?.llm_enabled) return ''
    const pending = data.picks
      .filter((p) => p.narrative_source === 'mechanical')
      .map((p) => p.ticker.toUpperCase())
    return [...new Set(pending)].join(',')
  }, [data])

  const { data: narrativeData } = useSWR<PickNarrativesResponse>(
    pendingNarrativeTickers ? `/api/picks/narratives?tickers=${pendingNarrativeTickers}` : null,
    narrativesFetcher,
    {
      revalidateOnFocus: false,
      dedupingInterval: 0,
      refreshInterval: (latest) => {
        if (!latest?.narratives || !pendingNarrativeTickers) return 0
        const pending = pendingNarrativeTickers.split(',')
        const allReady = pending.every(
          (ticker) => latest.narratives[ticker]?.narrative_source === 'llm',
        )
        return allReady ? 0 : 3000
      },
    },
  )

  const displayData = useMemo(() => {
    if (!data) return null

    let merged = data
    if (narrativeData?.narratives && Object.keys(narrativeData.narratives).length) {
      merged = {
        ...merged,
        picks: mergePickNarratives(merged.picks, narrativeData.narratives),
      }
    }
    if (headlineData?.headlines && Object.keys(headlineData.headlines).length) {
      merged = {
        ...merged,
        picks: mergePickHeadlines(merged.picks, headlineData.headlines),
      }
    }

    return merged
  }, [data, narrativeData, headlineData])

  return (
    <PicksRefreshProvider value={picksRefreshValue}>
      <div className="min-h-screen bg-zinc-950">
        <AppNav />

        <main id="main" className="page-shell !pt-1">
          <h1 className="sr-only">Picks</h1>

          {error ? (
            <p className="text-zinc-500 text-sm text-center py-16">Failed to load picks.</p>
          ) : (
            <PicksRankedList
              data={displayData ?? EMPTY_PICKS}
              marketSession={marketSession}
              loading={isLoading && !displayData}
            />
          )}
        </main>
      </div>
    </PicksRefreshProvider>
  )
}
