'use client'

import { useState, useRef, useEffect } from 'react'
import { MoreVertical, Trash2 } from 'lucide-react'
import useSWR from 'swr'
import StockLogo from '@/components/StockLogo'
import { cn } from '@/lib/utils'
import type { StockFundamentals } from '@/types'

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

interface StockSnapshot {
  price?: number | null
  change_1d_pct?: number | null
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
  onRemove: (ticker: string) => void
  /** When provided (watchlist batch load), skips per-card fundamentals fetch. */
  fundamentals?: StockFundamentals | null
  fundamentalsLoading?: boolean
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

function PctBadge({ value, label }: { value: number | null; label: string }) {
  if (value == null) return (
    <div className="flex flex-col items-center gap-1">
      <span className="text-[11px] text-zinc-500">{label}</span>
      <div className="h-3 w-10 rounded bg-zinc-700/60 animate-pulse" />
    </div>
  )
  const isPos = value >= 0
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className="text-[11px] text-zinc-500 font-medium">{label}</span>
      <span className={cn('text-sm font-bold tabular-nums', isPos ? 'text-emerald-400' : 'text-red-400')}>
        {fmtPct(value)}
      </span>
    </div>
  )
}

function Week52Range({
  high,
  low,
  current,
}: {
  high: number | null
  low: number | null
  current: number | null
}) {
  if (high == null || low == null || current == null || high === low) return null
  const pct = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100))
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-zinc-500 font-medium">52-week range</span>
        <span className="text-[10px] text-zinc-600">dot = today</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-zinc-500 tabular-nums shrink-0">${low.toFixed(0)}</span>
        <div className="flex-1 h-1.5 rounded-full bg-zinc-700/50 relative">
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-sm shadow-black/30"
            style={{ left: `calc(${pct}% - 5px)` }}
            aria-label="Current price in 52-week range"
          />
        </div>
        <span className="text-[11px] text-zinc-500 tabular-nums shrink-0">${high.toFixed(0)}</span>
      </div>
    </div>
  )
}

function AnalystRating({ buy, hold, sell }: { buy: number | null; hold: number | null; sell: number | null }) {
  if (buy == null) return (
    <div className="space-y-1.5">
      <div className="h-1.5 w-full rounded-full bg-zinc-700/60 animate-pulse" />
      <div className="h-3 w-32 rounded bg-zinc-700/60 animate-pulse" />
    </div>
  )
  const total = (buy ?? 0) + (hold ?? 0) + (sell ?? 0)
  if (!total) return null

  const buyPct = Math.round(((buy ?? 0) / total) * 100)
  const holdPct = Math.round(((hold ?? 0) / total) * 100)
  const sellPct = 100 - buyPct - holdPct

  return (
    <div className="space-y-1.5">
      <span className="text-[11px] text-zinc-500 font-medium">Analyst ratings</span>
      <div className="flex h-1.5 w-full rounded-full overflow-hidden gap-px">
        {buyPct > 0 && <div className="bg-emerald-500/70 rounded-l-full" style={{ width: `${buyPct}%` }} />}
        {holdPct > 0 && <div className="bg-yellow-500/60" style={{ width: `${holdPct}%` }} />}
        {sellPct > 0 && <div className="bg-red-500/60 rounded-r-full" style={{ width: `${sellPct}%` }} />}
      </div>
      {/* Counts */}
      <div className="flex items-center gap-3">
        <span className="text-xs font-semibold text-emerald-400 tabular-nums">{buy} buy</span>
        <span className="text-xs font-semibold text-yellow-400 tabular-nums">{hold} hold</span>
        <span className="text-xs font-semibold text-red-400 tabular-nums">{sell} sell</span>
      </div>
    </div>
  )
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

  if (current == null || targetPrice == null || targetPrice <= 0) return null

  const is52w = targetSource === '52w_high'
  const upside = ((targetPrice - current) / current) * 100
  const isPos = upside >= 0
  const subline = is52w ? 'Estimated · year high basis' : 'Wall Street average · 12 mo'

  const showRange =
    !is52w &&
    targetLow != null &&
    targetHigh != null &&
    targetHigh > targetLow

  return (
    <div className="rounded-xl bg-zinc-800/80 px-3 py-2.5 space-y-1">
      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Target price</p>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-lg font-black text-white tabular-nums leading-none">{fmtPrice(targetPrice)}</p>
          <p className="text-[10px] text-zinc-500 mt-1">{subline}</p>
        </div>
        <span
          className={cn(
            'text-sm font-bold tabular-nums px-2 py-1 rounded-lg shrink-0',
            isPos ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
          )}
        >
          {fmtPct(upside)}
        </span>
      </div>
      {showRange && (
        <p className="text-[10px] text-zinc-600 tabular-nums pt-0.5">
          Range {fmtPrice(targetLow)} – {fmtPrice(targetHigh)}
        </p>
      )}
    </div>
  )
}

export default function WatchlistCard({
  stock,
  onRemove,
  fundamentals: fundamentalsProp,
  fundamentalsLoading: fundamentalsLoadingProp,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
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
            onClick={() => { onRemove(stock.ticker); setConfirming(false) }}
            className="flex-1 min-h-[44px] text-sm font-medium rounded-xl bg-red-500/10 hover:bg-red-500/20 active:bg-red-500/30 text-red-400 border border-red-500/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 [touch-action:manipulation]"
          >
            Remove
          </button>
          <button
            autoFocus
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
    <div className="relative card-surface active:scale-[0.99] active:brightness-95 transition-all duration-100">
      {/* ── Top section: identity + live price ── */}
      <div className="px-5 pt-4 pb-3.5 flex items-start justify-between gap-3 pr-14">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <StockLogo ticker={stock.ticker} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="font-bold text-white text-lg tracking-tight" translate="no">
                {stock.ticker}
              </span>
            </div>
            <p className="text-sm text-zinc-500 truncate leading-relaxed">{stock.company_name}</p>
          </div>
        </div>

        <div className="text-right shrink-0">
          {price ? (
            <>
              <p className="text-lg font-bold text-white tabular-nums leading-tight">{price}</p>
              {pct && (
                <p className={cn('text-sm font-semibold tabular-nums mt-0.5', isUp ? 'text-emerald-400' : 'text-red-400')}>
                  {pct} today
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-zinc-600">—</p>
          )}
        </div>
      </div>

      {/* ── Metrics section ── */}
      <div className="mx-3 mb-3 bg-zinc-800/50 rounded-xl px-3 py-2.5 space-y-2.5">
        {/* 7d / 14d / 30d */}
        <div className="flex items-center justify-around">
          <PctBadge value={fundamentals?.change_7d_pct ?? null} label="7d" />
          <div className="w-px h-5 bg-zinc-700/60" />
          <PctBadge value={fundamentals?.change_14d_pct ?? null} label="14d" />
          <div className="w-px h-5 bg-zinc-700/60" />
          <PctBadge value={fundamentals?.change_30d_pct ?? null} label="30d" />
        </div>

        {/* Target — one clear block (not a second 52W slider) */}
        <TargetPrice
          targetPrice={fundamentals?.target_price ?? null}
          targetLow={fundamentals?.target_low ?? null}
          targetHigh={fundamentals?.target_high ?? null}
          targetSource={fundamentals?.target_source ?? null}
          current={currentPrice}
          loading={fundamentalsLoading && !fundamentals}
        />

        {/* Where price sits in the year (separate from target) */}
        <Week52Range
          high={fundamentals?.week52_high ?? null}
          low={fundamentals?.week52_low ?? null}
          current={currentPrice}
        />

        <AnalystRating
          buy={fundamentals?.analyst_buy ?? null}
          hold={fundamentals?.analyst_hold ?? null}
          sell={fundamentals?.analyst_sell ?? null}
        />
      </div>

      {/* ── 3-dot menu ── */}
      <div ref={menuRef} className="absolute right-1 top-2">
        <button
          ref={menuButtonRef}
          type="button"
          aria-label={`Options for ${stock.ticker}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
          className="w-11 h-11 flex items-center justify-center rounded-xl text-zinc-600 active:text-zinc-300 active:bg-white/5 transition-colors focus-visible:outline-none [touch-action:manipulation]"
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
