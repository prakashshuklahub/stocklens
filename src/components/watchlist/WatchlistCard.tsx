'use client'

import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { MoreVertical, Trash2, Target, Activity, BarChart3, Users, Gauge } from 'lucide-react'
import useSWR from 'swr'
import StockLogo from '@/components/StockLogo'
import AnalystMiniGrid from '@/components/AnalystMiniGrid'
import PriceChartPanel, { priceChartCollapsedPreview } from '@/components/PriceChartPanel'
import StockResearchPanel, { researchCollapsedPreview } from '@/components/StockResearchPanel'
import VsSectorPanel, { vsSectorCollapsedPreview } from '@/components/VsSectorPanel'
import SessionPriceBadge from '@/components/SessionPriceBadge'
import CollapseChevron from '@/components/CollapseChevron'
import Week52Range from '@/components/Week52Range'
import SignalReasonChips from '@/components/signals/SignalReasonChips'
import SignalHeadlinesAccordion from '@/components/signals/SignalHeadlinesAccordion'
import {
  computeTargetUpsidePct,
  formatDisplayTargetPrice,
  formatDisplayUpsideDollar,
  formatDisplayUpsidePct,
  formatTargetPrice,
  hasDisplayTargetPrice,
} from '@/lib/target-price-display'
import { priceBadgeSession, type MarketSession } from '@/lib/market-hours'
import { vsSectorBadgeLabel } from '@/lib/sector-relative-strength'
import { isBenchmarkableSector, normalizeWatchlistSector } from '@/lib/sector-relative-strength-scoring'
import { cn } from '@/lib/utils'
import type { SectorBenchmark, SectorRelativeStrength, Signal, SignalReason, StockFundamentals, StockSnapshot } from '@/types'

const SECTOR_COLORS: Record<string, { bg: string; text: string }> = {
  Technology:               { bg: 'bg-blue-500/10',    text: 'text-blue-400' },
  Healthcare:               { bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  Financials:               { bg: 'bg-yellow-500/10',  text: 'text-yellow-400' },
  'Consumer Discretionary': { bg: 'bg-orange-500/10',  text: 'text-orange-400' },
  'Consumer Staples':       { bg: 'bg-amber-500/10',   text: 'text-amber-400' },
  Energy:                   { bg: 'bg-red-500/10',     text: 'text-red-400' },
  Industrials:              { bg: 'bg-slate-500/10',   text: 'text-slate-400' },
  Materials:                { bg: 'bg-lime-500/10',    text: 'text-lime-400' },
  Utilities:                { bg: 'bg-teal-500/10',    text: 'text-teal-400' },
  'Real Estate':            { bg: 'bg-purple-500/10',  text: 'text-purple-400' },
  'Communication Services': { bg: 'bg-pink-500/10',    text: 'text-pink-400' },
}

export interface WatchlistStock {
  id: string
  ticker: string
  company_name: string
  sector: string | null
  added_at: string
  snapshot?: StockSnapshot | null
}

interface Props {
  stock: WatchlistStock
  onRemove: (ticker: string) => void | Promise<void>
  /** Client clock session — fallback for Closed / Pre-market badges. */
  marketSession?: MarketSession
  /** When provided (watchlist batch load), skips per-card fundamentals fetch. */
  fundamentals?: StockFundamentals | null
  fundamentalsLoading?: boolean
  vsSector?: SectorRelativeStrength | null
  sectorBenchmark?: SectorBenchmark | null
  /** Regular-session 1d % — never extended hours (from batch API). */
  regularChange1dPct?: number | null
  sectorBenchmarksRefreshing?: boolean
  signal?: Signal | null
  signalLoading?: boolean
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function fmtPrice(n: number | null | undefined) {
  if (n == null) return null
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtPct(n: number | null | undefined, showPlus = true) {
  if (n == null) return null
  return `${showPlus && n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function TargetPrice({
  targetPrice,
  targetLow,
  targetHigh,
  targetSource,
  current,
  loading,
}: {
  targetPrice: number | null
  targetLow: number | null
  targetHigh: number | null
  targetSource: StockFundamentals['target_source']
  current: number | null
  loading?: boolean
}) {
  if (loading) {
    return (
      <div className="rounded-xl bg-zinc-800/80 px-3 py-2.5 space-y-2">
        <div className="h-3 w-16 rounded bg-zinc-700/60 animate-pulse" />
        <div className="h-5 w-28 rounded bg-zinc-700/60 animate-pulse" />
      </div>
    )
  }

  const showTarget = hasDisplayTargetPrice(targetPrice, targetSource)
  const upside = showTarget ? computeTargetUpsidePct(targetPrice, current) : null
  const isPos = upside != null && upside >= 0

  const showRange =
    showTarget &&
    targetLow != null &&
    targetHigh != null &&
    targetHigh > targetLow

  return (
    <div className="rounded-xl bg-zinc-800/80 px-3 py-2.5 space-y-1">
      <div>
        <p className="type-micro font-bold text-zinc-500 uppercase tracking-wider">Room to grow</p>
        <p
          className={cn(
            'text-lg font-black tabular-nums leading-none mt-0.5',
            !showTarget || upside == null
              ? 'text-zinc-500'
              : isPos
                ? 'text-emerald-400'
                : 'text-red-400',
          )}
        >
          {formatDisplayUpsidePct(targetPrice, current, targetSource)}
        </p>
        {showTarget && (
          <p className="type-micro text-zinc-500 tabular-nums mt-1">
            {formatDisplayUpsideDollar(targetPrice, current, targetSource)} to{' '}
            {formatDisplayTargetPrice(targetPrice, targetSource)}
          </p>
        )}
      </div>
      {showRange && (
        <p className="type-micro text-muted tabular-nums pt-0.5">
          Analyst range {formatTargetPrice(targetLow)} – {formatTargetPrice(targetHigh)}
        </p>
      )}
    </div>
  )
}

function signalCovers7d(reasons: SignalReason[]): boolean {
  return reasons.some((r) => /\b7d\b|in 7d/i.test(r.label))
}

function signalCovers30d(reasons: SignalReason[]): boolean {
  return reasons.some((r) => /\b30d\b|in 30d/i.test(r.label))
}

function signalCoversTarget(reasons: SignalReason[]): boolean {
  return reasons.some((r) => /target|room to grow/i.test(r.label))
}

function SupplementalSummaryChips({
  fundamentals,
  currentPrice,
  signalReasons,
}: {
  fundamentals: StockFundamentals | null | undefined
  currentPrice: number | null
  signalReasons: SignalReason[]
}) {
  if (!fundamentals) return null

  const showTarget = hasDisplayTargetPrice(
    fundamentals.target_price,
    fundamentals.target_source ?? null,
  )
  const upside = showTarget
    ? formatDisplayUpsidePct(
        fundamentals.target_price,
        currentPrice,
        fundamentals.target_source ?? null,
      )
    : null

  const chipClass = 'text-sm sm:text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap'

  return (
    <>
      {fundamentals.change_7d_pct != null && !signalCovers7d(signalReasons) && (
        <span
          className={cn(
            chipClass,
            'tabular-nums',
            fundamentals.change_7d_pct >= 0
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400',
          )}
        >
          7d {fmtPct(fundamentals.change_7d_pct)}
        </span>
      )}
      {fundamentals.change_30d_pct != null && !signalCovers30d(signalReasons) && (
        <span
          className={cn(
            chipClass,
            'tabular-nums',
            fundamentals.change_30d_pct >= 0
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400',
          )}
        >
          30d {fmtPct(fundamentals.change_30d_pct)}
        </span>
      )}
      {!signalCoversTarget(signalReasons) && (
        showTarget && upside && upside !== '—' ? (
          <span className={cn(chipClass, 'tabular-nums bg-zinc-800 text-zinc-300')}>
            Room to grow {upside}
          </span>
        ) : (
          <span className={cn(chipClass, 'font-medium bg-zinc-800/80 text-zinc-500')}>
            No target
          </span>
        )
      )}
    </>
  )
}

function CollapsedSummary({
  fundamentals,
  currentPrice,
  loading,
  vsSector,
  sectorBenchmarksRefreshing,
  inset = false,
}: {
  fundamentals: StockFundamentals | null | undefined
  currentPrice: number | null
  loading: boolean
  vsSector?: SectorRelativeStrength | null
  sectorBenchmarksRefreshing?: boolean
  inset?: boolean
}) {
  const showTarget = hasDisplayTargetPrice(
    fundamentals?.target_price,
    fundamentals?.target_source ?? null,
  )
  const upside = showTarget
    ? formatDisplayUpsidePct(
        fundamentals?.target_price,
        currentPrice,
        fundamentals?.target_source ?? null,
      )
    : null

  if (loading && !fundamentals) {
    return (
      <div className={cn('flex gap-2 pb-1', inset ? 'px-0' : 'px-5 pb-1')}>
        <div className="h-6 w-16 rounded-full bg-zinc-800 animate-pulse" />
        <div className="h-6 w-16 rounded-full bg-zinc-800 animate-pulse" />
        <div className="h-6 w-24 rounded-full bg-zinc-800 animate-pulse" />
      </div>
    )
  }

  if (!fundamentals && !loading) {
    return null
  }

  const badgeLabel = vsSectorBadgeLabel(vsSector?.badge ?? null)
  const showSectorBadge = Boolean(badgeLabel && vsSector?.sector !== 'Other')

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5 pb-1', inset ? 'px-0' : 'px-5 pb-1')}>
      {showSectorBadge && (
        <span
          className={cn(
            'text-sm sm:text-xs font-semibold px-2 py-0.5 rounded-full',
            vsSector?.badge === 'leader' && 'bg-emerald-500/10 text-emerald-400',
            vsSector?.badge === 'lagger' && 'bg-red-500/10 text-red-400',
            vsSector?.badge === 'inline' && 'bg-zinc-800 text-zinc-400',
            sectorBenchmarksRefreshing && 'opacity-70',
          )}
        >
          {sectorBenchmarksRefreshing ? 'Updating sector…' : badgeLabel}
        </span>
      )}
      {fundamentals?.change_7d_pct != null && (
        <span
          className={cn(
            'text-sm sm:text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full',
            fundamentals.change_7d_pct >= 0
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400',
          )}
        >
          7d {fmtPct(fundamentals.change_7d_pct)}
        </span>
      )}
      {fundamentals?.change_30d_pct != null && (
        <span
          className={cn(
            'text-sm sm:text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full',
            fundamentals.change_30d_pct >= 0
              ? 'bg-emerald-500/10 text-emerald-400'
              : 'bg-red-500/10 text-red-400',
          )}
        >
          30d {fmtPct(fundamentals.change_30d_pct)}
        </span>
      )}
      {showTarget && upside && upside !== '—' ? (
        <span className="text-sm sm:text-xs font-semibold tabular-nums px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300">
          Room to grow {upside}
        </span>
      ) : (
        <span className="text-sm sm:text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-500">
          No target
        </span>
      )}
    </div>
  )
}

type WatchlistAccordionKey = 'room' | 'moves' | 'research' | 'sector' | 'analyst'

const WATCHLIST_SECTIONS_CLOSED: Record<WatchlistAccordionKey, boolean> = {
  room: false,
  moves: false,
  research: false,
  sector: false,
  analyst: false,
}

function roomPreview(
  fundamentals: StockFundamentals | null | undefined,
  currentPrice: number | null,
): string {
  const showTarget = hasDisplayTargetPrice(
    fundamentals?.target_price,
    fundamentals?.target_source ?? null,
  )
  const upside = showTarget
    ? formatDisplayUpsidePct(
        fundamentals?.target_price,
        currentPrice,
        fundamentals?.target_source ?? null,
      )
    : null
  const target = showTarget && fundamentals?.target_price != null
    ? formatDisplayTargetPrice(fundamentals.target_price, fundamentals.target_source ?? null)
    : null

  const parts: string[] = []
  if (upside && upside !== '—') parts.push(`Room to grow ${upside}`)
  else parts.push('No target')
  if (target) parts.push(`target ${target}`)
  return parts.join(' · ')
}

function movesPreview(
  fundamentals: StockFundamentals | null | undefined,
  change1dPct: number | null | undefined,
): string {
  return priceChartCollapsedPreview({
    change1d: change1dPct,
    change7d: fundamentals?.change_7d_pct,
    change30d: fundamentals?.change_30d_pct,
  })
}

function sectorPreview(
  vsSector: SectorRelativeStrength | null | undefined,
  stockSector: string | null | undefined,
): string | null {
  return vsSectorCollapsedPreview(vsSector, stockSector)
}

function analystPreview(fundamentals: StockFundamentals | null | undefined): string {
  if (fundamentals?.analyst_buy == null) return 'Analyst ratings'
  return `${fundamentals.analyst_buy} buy · ${fundamentals.analyst_hold ?? 0} hold · ${fundamentals.analyst_sell ?? 0} sell`
}

function WatchlistAccordionRow({
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
  const [panelMounted, setPanelMounted] = useState(open)

  useEffect(() => {
    if (open) setPanelMounted(true)
  }, [open])

  return (
    <div className="border-t border-white/[0.04]">
      <button
        type="button"
        id={`${id}-trigger`}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={onToggle}
        className={cn(
          'w-full text-left px-5 py-3 min-h-[48px]',
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
            <p
              className={cn(
                'type-meta text-muted-preview mt-1 leading-snug truncate overflow-hidden transition-[opacity,max-height,margin] duration-150',
                open ? 'opacity-0 max-h-0 mt-0' : 'opacity-100 max-h-6',
              )}
              aria-hidden={open}
            >
              {preview}
            </p>
          </div>
          <CollapseChevron open={open} className="text-muted shrink-0 mt-0.5" />
        </div>
      </button>
      {panelMounted && (
        <div
          id={`${id}-panel`}
          role="region"
          aria-labelledby={`${id}-trigger`}
          hidden={!open}
          className={cn('px-5 pb-3.5 pt-0', !open && 'hidden')}
        >
          {children}
        </div>
      )}
    </div>
  )
}

export default function WatchlistCard({
  stock,
  onRemove,
  marketSession = 'regular',
  fundamentals: fundamentalsProp,
  fundamentalsLoading: fundamentalsLoadingProp,
  vsSector,
  sectorBenchmark,
  regularChange1dPct,
  sectorBenchmarksRefreshing,
  signal,
  signalLoading,
}: Props) {
  const cardId = `watchlist-${stock.ticker}`

  const [sections, setSections] = useState<Record<WatchlistAccordionKey, boolean>>(() => ({
    ...WATCHLIST_SECTIONS_CLOSED,
  }))

  const toggleSection = useCallback((key: WatchlistAccordionKey) => {
    setSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  const { data: fundamentalsSwr, isLoading: fundamentalsSwrLoading } = useSWR<StockFundamentals>(
    fundamentalsProp === undefined ? `/api/fundamentals/${stock.ticker}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 3_600_000, // 1 hour
    }
  )

  const fundamentals = fundamentalsProp !== undefined ? fundamentalsProp : fundamentalsSwr
  const fundamentalsLoading =
    fundamentalsLoadingProp ?? (fundamentalsProp === undefined ? fundamentalsSwrLoading : false)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    function keyHandler(e: KeyboardEvent) {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [])

  const snap = stock.snapshot
  const price = fmtPrice(snap?.price)
  const pct = fmtPct(snap?.change_1d_pct)
  const isUp = (snap?.change_1d_pct ?? 0) >= 0
  const currentPrice = snap?.price ?? null
  const badgeSession = priceBadgeSession(snap?.session, marketSession)
  const sectorLabel = vsSector?.sector ?? normalizeWatchlistSector(stock.sector)
  const hasSector = sectorLabel !== 'Other' && isBenchmarkableSector(sectorLabel)
  const sectorPreviewText = sectorPreview(vsSector, stock.sector)
  const sectorBadgeLabel = vsSectorBadgeLabel(vsSector?.badge ?? null)
  const showSectorBadge = Boolean(sectorBadgeLabel && vsSector?.sector !== 'Other')
  const change1d = regularChange1dPct ?? snap?.change_1d_pct ?? null
  const analystTotal =
    (fundamentals?.analyst_buy ?? 0) +
    (fundamentals?.analyst_hold ?? 0) +
    (fundamentals?.analyst_sell ?? 0)

  const fundamentalsPending = fundamentalsLoading && fundamentals == null

  if (confirming) {
    return (
      <div
        role="alertdialog"
        aria-labelledby={`confirm-label-${stock.ticker}`}
        className="rounded-2xl bg-zinc-900 px-4 py-4"
      >
        <p id={`confirm-label-${stock.ticker}`} className="text-sm text-zinc-300 mb-4">
          Remove <span className="font-semibold text-white" translate="no">{stock.ticker}</span> from your watchlist?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={removing}
            onClick={() => {
              void (async () => {
                setRemoving(true)
                try {
                  await onRemove(stock.ticker)
                  setConfirming(false)
                } finally {
                  setRemoving(false)
                }
              })()
            }}
            className="flex-1 min-h-[44px] text-sm font-medium rounded-xl bg-red-500/10 hover:bg-red-500/20 active:bg-red-500/30 text-red-400 border border-red-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 [touch-action:manipulation]"
          >
            {removing ? 'Removing…' : 'Remove'}
          </button>
          <button
            type="button"
            autoFocus
            disabled={removing}
            onClick={() => { setConfirming(false); menuButtonRef.current?.focus() }}
            className="flex-1 min-h-[44px] text-sm font-medium rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 [touch-action:manipulation]"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="relative card-surface overflow-hidden">
      <div className="px-5 pt-4 pb-2 pr-14">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <StockLogo ticker={stock.ticker} size="md" />
            <div className="min-w-0 flex-1">
              <span className="font-bold text-white text-lg tracking-tight" translate="no">
                {stock.ticker}
              </span>
              <p className="text-sm text-zinc-500 truncate leading-relaxed">{stock.company_name}</p>
            </div>
          </div>

          <div className="text-right shrink-0">
            {price ? (
              <>
                <div className="flex items-center justify-end gap-1.5">
                  <p className="text-lg font-bold text-white tabular-nums leading-tight">{price}</p>
                  {badgeSession && (
                    <SessionPriceBadge session={badgeSession} />
                  )}
                </div>
                {pct && (
                  <p className={cn('text-sm font-semibold tabular-nums mt-0.5', isUp ? 'text-emerald-400' : 'text-red-400')}>
                    {pct}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-muted">—</p>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {signalLoading && !signal ? (
            <>
              <div className="h-6 w-20 rounded-full bg-zinc-800 animate-pulse" aria-hidden="true" />
              <div className="h-6 w-24 rounded-full bg-zinc-800 animate-pulse" aria-hidden="true" />
              <div className="h-6 w-16 rounded-full bg-zinc-800 animate-pulse" aria-hidden="true" />
            </>
          ) : signal?.reasons.length ? (
            <>
              {showSectorBadge && (
                <span
                  className={cn(
                    'text-sm sm:text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap',
                    vsSector?.badge === 'leader' && 'bg-emerald-500/10 text-emerald-400',
                    vsSector?.badge === 'lagger' && 'bg-red-500/10 text-red-400',
                    vsSector?.badge === 'inline' && 'bg-zinc-800 text-zinc-400',
                    sectorBenchmarksRefreshing && 'opacity-70',
                  )}
                >
                  {sectorBenchmarksRefreshing ? 'Updating sector…' : sectorBadgeLabel}
                </span>
              )}
              <SupplementalSummaryChips
                fundamentals={fundamentals}
                currentPrice={currentPrice}
                signalReasons={signal.reasons}
              />
              <SignalReasonChips reasons={signal.reasons} className="contents" />
            </>
          ) : (
            <CollapsedSummary
              fundamentals={fundamentals}
              currentPrice={currentPrice}
              loading={fundamentalsPending}
              vsSector={vsSector}
              sectorBenchmarksRefreshing={sectorBenchmarksRefreshing}
              inset
            />
          )}
        </div>
      </div>

      <WatchlistAccordionRow
        id={`${cardId}-room`}
        label="Room to grow"
        preview={roomPreview(fundamentals, currentPrice)}
        open={sections.room}
        onToggle={() => toggleSection('room')}
        icon={Target}
      >
        <div className="space-y-2.5 rounded-xl bg-zinc-800/50 px-3 py-2.5 border border-white/[0.04]">
          <TargetPrice
            targetPrice={fundamentals?.target_price ?? null}
            targetLow={fundamentals?.target_low ?? null}
            targetHigh={fundamentals?.target_high ?? null}
            targetSource={fundamentals?.target_source ?? null}
            current={currentPrice}
            loading={fundamentalsPending && !fundamentals}
          />
          <Week52Range
            high={fundamentals?.week52_high ?? null}
            low={fundamentals?.week52_low ?? null}
            current={currentPrice}
          />
        </div>
      </WatchlistAccordionRow>

      <WatchlistAccordionRow
        id={`${cardId}-moves`}
        label="Price chart"
        preview={movesPreview(fundamentals, change1d)}
        open={sections.moves}
        onToggle={() => toggleSection('moves')}
        icon={Activity}
      >
        <PriceChartPanel
          ticker={stock.ticker}
          volumeRatio={fundamentals?.volume_ratio ?? null}
        />
      </WatchlistAccordionRow>

      <WatchlistAccordionRow
        id={`${cardId}-research`}
        label="Key research"
        preview={researchCollapsedPreview()}
        open={sections.research}
        onToggle={() => toggleSection('research')}
        icon={Gauge}
      >
        <StockResearchPanel ticker={stock.ticker} />
      </WatchlistAccordionRow>

      {hasSector && sectorPreviewText && (
        <WatchlistAccordionRow
          id={`${cardId}-sector`}
          label="Vs sector"
          preview={sectorPreviewText}
          open={sections.sector}
          onToggle={() => toggleSection('sector')}
          icon={BarChart3}
        >
          <VsSectorPanel
            vsSector={vsSector}
            sectorBenchmark={sectorBenchmark}
            stockSector={stock.sector}
            regularChange1dPct={regularChange1dPct}
            stockChange1d={snap?.change_1d_pct ?? null}
            snapshotSession={snap?.session}
            marketSession={marketSession}
            refreshing={sectorBenchmarksRefreshing}
          />
        </WatchlistAccordionRow>
      )}

      <WatchlistAccordionRow
        id={`${cardId}-analyst`}
        label="Analyst views"
        preview={analystPreview(fundamentals)}
        open={sections.analyst}
        onToggle={() => toggleSection('analyst')}
        icon={Users}
      >
        <AnalystMiniGrid
          buy={fundamentals?.analyst_buy ?? null}
          hold={fundamentals?.analyst_hold ?? null}
          sell={fundamentals?.analyst_sell ?? null}
          total={analystTotal}
          loading={fundamentalsPending}
        />
      </WatchlistAccordionRow>

      {(signal || signalLoading) && (
        <SignalHeadlinesAccordion
          cardId={cardId}
          news={signal?.news ?? []}
          bias={signal?.bias}
          inset
        />
      )}

      {/* ── 3-dot menu ── */}
      <div ref={menuRef} className="absolute right-1 top-2">
        <button
          ref={menuButtonRef}
          type="button"
          aria-label={`Options for ${stock.ticker}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="w-11 h-11 flex items-center justify-center rounded-xl text-muted active:text-zinc-300 active:bg-white/5 transition-colors focus-visible:outline-none [touch-action:manipulation]"
        >
          <MoreVertical className="w-4 h-4" aria-hidden="true" />
        </button>

        {menuOpen && (
          <div
            role="menu"
            aria-label={`Actions for ${stock.ticker}`}
            className="absolute right-0 mt-1 w-44 bg-zinc-800 border border-white/10 rounded-2xl overflow-hidden z-20 shadow-2xl shadow-black/60"
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => { setMenuOpen(false); setConfirming(true) }}
              className="w-full flex items-center gap-3 px-4 py-3.5 text-sm text-red-400 active:bg-red-500/10 transition-colors focus-visible:outline-none [touch-action:manipulation]"
            >
              <Trash2 className="w-4 h-4" aria-hidden="true" />
              Remove from list
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
