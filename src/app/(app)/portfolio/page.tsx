'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import * as XLSX from 'xlsx'
import {
  PieChart,
  Upload,
  RefreshCw,
  CheckCircle,
  X,
  AlertCircle,
} from 'lucide-react'
import AppNav from '@/components/AppNav'
import StockLogo from '@/components/StockLogo'
import { HoldingCard } from '@/components/portfolio/HoldingCard'
import HoldingsCompactList from '@/components/portfolio/HoldingsCompactList'
import HoldingsTableList from '@/components/portfolio/HoldingsTableList'
import PortfolioDailySummary from '@/components/portfolio/PortfolioDailySummary'
import PortfolioHoldingsViewToggle, {
  loadPortfolioHoldingsView,
  persistPortfolioHoldingsView,
  type PortfolioHoldingsView,
} from '@/components/portfolio/PortfolioHoldingsViewToggle'
import {
  PortfolioCompactHoldingsSkeleton,
  PortfolioHoldingsSkeleton,
  PortfolioSummarySkeleton,
  PortfolioTableHoldingsSkeleton,
} from '@/components/portfolio/PortfolioSkeletons'
import { RefreshCountdown } from '@/components/LiveRefreshHeader'
import { useMarketOpen } from '@/hooks/useMarketOpen'
import { useLivePriceRefresh } from '@/hooks/useLivePriceRefresh'
import { PORTFOLIO_LIVE_REFRESH_SEC } from '@/lib/market-hours'
import { computeHoldingMetrics } from '@/lib/portfolio-holding-metrics'
import { mergePriceSnapshots } from '@/lib/portfolio-signals'
import { cn } from '@/lib/utils'
import type {
  PortfolioHoldingWithPrice,
  PortfolioHoldingWithSignal,
  PortfolioWithSignalsResponse,
  VestedRow,
} from '@/types'

const signalsFetcher = async (url: string): Promise<PortfolioWithSignalsResponse> => {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('Request failed')
  return res.json()
}

function fmt(n: number, decimals = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function parseVestedXlsx(file: File): Promise<VestedRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets['Holdings']
        if (!ws) throw new Error('No "Holdings" sheet found in this file.')
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
        const parsed: VestedRow[] = rows.map((r) => ({
          name: String(r['Name'] ?? ''),
          ticker: String(r['Ticker'] ?? '').toUpperCase(),
          shares: Number(r['Total Shares Held'] ?? 0),
          avgCost: Number(r['Average Cost (USD)'] ?? 0),
          totalInvested: Number(r['Total Amount Invested (USD)'] ?? 0),
        })).filter((r) => r.ticker && r.shares > 0)
        if (!parsed.length) throw new Error('No valid holdings rows found.')
        resolve(parsed)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file.'))
    reader.readAsArrayBuffer(file)
  })
}

// ── Summary card ──────────────────────────────────────────────────────────────
interface PortfolioSummaryStats {
  totalInvested: number
  totalCurrent: number
  pnl: number
  pnlPct: number
  dayGain: number | null
  dayPct: number | null
}

function computePortfolioSummary(
  holdings: PortfolioHoldingWithPrice[],
): PortfolioSummaryStats {
  let totalInvested = 0
  let totalCurrent = 0
  let totalDayGain = 0
  let totalPrevCloseValue = 0

  for (const h of holdings) {
    totalInvested += h.avg_cost_basis * h.quantity
    const price = h.snapshot?.price
    const change1d = h.snapshot?.change_1d_pct
    if (price != null) {
      totalCurrent += price * h.quantity
      if (change1d != null) {
        const prevClose = price / (1 + change1d / 100)
        totalDayGain += (price - prevClose) * h.quantity
        totalPrevCloseValue += prevClose * h.quantity
      }
    }
  }

  const pnl = totalCurrent - totalInvested
  const pnlPct = totalInvested ? (pnl / totalInvested) * 100 : 0
  const hasDayData = totalPrevCloseValue > 0

  return {
    totalInvested,
    totalCurrent,
    pnl,
    pnlPct,
    dayGain: hasDayData ? totalDayGain : null,
    dayPct: hasDayData ? (totalDayGain / totalPrevCloseValue) * 100 : null,
  }
}

function signedPct(n: number) {
  return `${n >= 0 ? '+' : ''}${fmt(n)}%`
}

function signedDollar(n: number) {
  return `${n >= 0 ? '+' : '-'}$${fmt(Math.abs(n))}`
}

function pnlTone(positive: boolean) {
  return positive
    ? { text: 'text-emerald-400', bg: 'bg-emerald-500/15 text-emerald-400' }
    : { text: 'text-red-400', bg: 'bg-red-500/15 text-red-400' }
}

function SummaryBar({
  holdings,
}: {
  holdings: PortfolioHoldingWithPrice[]
}) {
  const stats = computePortfolioSummary(holdings)
  const allTimePos = stats.pnl >= 0
  const dayPos = (stats.dayGain ?? 0) >= 0
  const allTone = pnlTone(allTimePos)
  const dayTone = pnlTone(dayPos)

  return (
    <div className="portfolio-summary mb-4">
      <div className="portfolio-summary-inner px-4 py-3">
        <p className="type-micro text-zinc-400 mb-1">Current Value</p>
        <p className="text-2xl font-black text-white tabular-nums leading-none">
          ${fmt(stats.totalCurrent)}
        </p>

        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-300">Today</p>
          {stats.dayGain != null && stats.dayPct != null ? (
            <p className={cn('text-sm font-bold tabular-nums', dayTone.text)}>
              {signedDollar(stats.dayGain)} ({signedPct(stats.dayPct)})
            </p>
          ) : (
            <p className="text-sm font-semibold text-zinc-600 tabular-nums">—</p>
          )}
        </div>

        <div className="mt-2 pt-2 border-t border-white/[0.06] flex items-center justify-between gap-3">
          <p className="text-sm text-zinc-300">Unrealized P&L</p>
          <p className={cn('text-sm font-bold tabular-nums', allTone.text)}>
            {signedDollar(stats.pnl)} ({signedPct(stats.pnlPct)})
          </p>
        </div>
      </div>
    </div>
  )
}

/** Highest today % first; missing day change last; tie-break by ticker. */
function sortHoldingsByTodayPctDesc(
  holdings: PortfolioHoldingWithSignal[],
): PortfolioHoldingWithSignal[] {
  return [...holdings].sort((a, b) => {
    const ca = computeHoldingMetrics(a).change1d
    const cb = computeHoldingMetrics(b).change1d
    if (ca == null && cb == null) return a.ticker.localeCompare(b.ticker)
    if (ca == null) return 1
    if (cb == null) return -1
    if (cb !== ca) return cb - ca
    return a.ticker.localeCompare(b.ticker)
  })
}

function HoldingsSection({
  holdings,
  countdown,
  refreshing,
  marketOpen,
  loading,
}: {
  holdings: PortfolioHoldingWithSignal[]
  countdown: number
  refreshing: boolean
  marketOpen: boolean
  loading?: boolean
}) {
  const [view, setView] = useState<PortfolioHoldingsView>(() => loadPortfolioHoldingsView())

  useEffect(() => {
    persistPortfolioHoldingsView(view)
  }, [view])

  const onViewChange = useCallback((next: PortfolioHoldingsView) => {
    setView(next)
  }, [])

  const sortedHoldings = useMemo(() => sortHoldingsByTodayPctDesc(holdings), [holdings])

  const showToolbar = loading || holdings.length > 0

  return (
    <section className="mb-5" aria-label="Your holdings">
      {showToolbar && (
        <div className="flex items-center justify-between gap-2 mb-2 px-0.5 min-h-[28px]">
          <span className="text-xs text-zinc-500 tabular-nums">
            {loading ? '…' : `${holdings.length} stock${holdings.length === 1 ? '' : 's'}`}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            {marketOpen && !loading && (
              <RefreshCountdown
                seconds={countdown}
                refreshing={refreshing}
                intervalSec={PORTFOLIO_LIVE_REFRESH_SEC}
              />
            )}
            {!loading && (
              <PortfolioHoldingsViewToggle value={view} onChange={onViewChange} />
            )}
          </div>
        </div>
      )}

      {loading ? (
        view === 'compact' ? (
          <PortfolioCompactHoldingsSkeleton count={Math.max(holdings.length, 4)} />
        ) : view === 'table' ? (
          <PortfolioTableHoldingsSkeleton count={Math.max(holdings.length, 5)} />
        ) : (
          <PortfolioHoldingsSkeleton count={4} />
        )
      ) : view === 'compact' ? (
        <HoldingsCompactList holdings={sortedHoldings} />
      ) : view === 'table' ? (
        <HoldingsTableList holdings={sortedHoldings} />
      ) : (
        <div className="space-y-3">
          {sortedHoldings.map((h) => (
            <HoldingCard key={h.id} h={h} />
          ))}
        </div>
      )}

      {!loading && holdings.length > 0 && (
        <p className="type-micro text-muted mt-2 leading-snug px-0.5">
          Live prices update every 8s during market hours.
        </p>
      )}
    </section>
  )
}

// ── Preview bottom sheet ──────────────────────────────────────────────────────
function PreviewSheet({
  rows,
  onConfirm,
  onCancel,
  saving,
}: {
  rows: VestedRow[]
  onConfirm: () => void
  onCancel: () => void
  saving: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 bg-zinc-950/90 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between px-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-3 border-b border-white/[0.06]">
        <div>
          <h2 className="text-base font-bold text-white">Preview Holdings</h2>
          <p className="text-xs text-zinc-500 mt-0.5">{rows.length} stocks from Vested</p>
        </div>
        <button
          onClick={onCancel}
          disabled={saving}
          aria-label="Cancel"
          className="w-11 h-11 flex items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-300 active:bg-zinc-800 [touch-action:manipulation]"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {rows.map((r) => (
          <div key={r.ticker} className="rounded-xl bg-zinc-900 border border-zinc-800/60 px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <StockLogo ticker={r.ticker} size="sm" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white">{r.ticker}</p>
              <p className="text-xs text-zinc-500 truncate">{r.name}</p>
            </div>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm text-white tabular-nums">{fmt(r.shares, 4)} shares</p>
              <p className="text-xs text-zinc-500 tabular-nums">avg ${fmt(r.avgCost)} · inv ${fmt(r.avgCost * r.shares)}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="px-4 pt-3 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] border-t border-zinc-900 bg-zinc-950">
        <button
          onClick={onConfirm}
          disabled={saving}
          className="w-full h-12 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2 transition-colors [touch-action:manipulation]"
        >
          {saving ? (
            <><RefreshCw className="w-4 h-4 animate-spin" />Saving…</>
          ) : (
            <><CheckCircle className="w-4 h-4" />Confirm &amp; Save</>
          )}
        </button>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PortfolioPage() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<VestedRow[] | null>(null)
  const [parseError, setParseError] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const marketOpen = useMarketOpen()

  const {
    data: portfolioData,
    isLoading,
    isValidating,
    mutate,
  } = useSWR<PortfolioWithSignalsResponse>(
    '/api/portfolio?include=signals',
    signalsFetcher,
    {
      revalidateOnFocus: false,
      onSuccess: (data) => {
        if (data?.holdings?.length) setSavedAt(data.holdings[0].synced_at)
      },
    },
  )

  const holdings = portfolioData?.holdings ?? []
  const refreshing = isValidating && !isLoading

  const refreshPrices = useCallback(async () => {
    const res = await fetch('/api/portfolio', { cache: 'no-store' })
    if (!res.ok) return
    const prices = (await res.json()) as PortfolioHoldingWithPrice[]
    mutate(
      (current) => {
        if (!current?.holdings?.length) return current
        return {
          ...current,
          holdings: mergePriceSnapshots(current.holdings, prices),
        }
      },
      { revalidate: false },
    )
  }, [mutate])

  const countdown = useLivePriceRefresh(
    marketOpen && holdings.length > 0,
    refreshPrices,
    PORTFOLIO_LIVE_REFRESH_SEC,
  )

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!fileInputRef.current) return
    fileInputRef.current.value = ''
    if (!file) return
    setParseError('')
    try {
      const rows = await parseVestedXlsx(file)
      setPreview(rows)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse file.')
    }
  }

  async function handleConfirm() {
    if (!preview) return
    setSaving(true)
    try {
      const res = await fetch('/api/portfolio/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          holdings: preview.map((r) => ({
            ticker: r.ticker,
            company_name: r.name,
            quantity: r.shares,
            avg_cost_basis: r.avgCost,
          })),
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setParseError(d.error ?? 'Sync failed.')
        return
      }
      setSavedAt(new Date().toISOString())
      setPreview(null)
      await mutate()
    } finally {
      setSaving(false)
    }
  }

  function timeAgo(iso: string): string {
    const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
    if (secs < 60) return 'just now'
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    if (days === 1) return 'yesterday'
    if (days < 7) return `${days}d ago`
    return `${Math.floor(days / 7)}w ago`
  }

  const syncedLabel = savedAt ? timeAgo(savedAt) : null
  const portfolioPending = isLoading && !portfolioData

  return (
    <>
      {preview && (
        <PreviewSheet
          rows={preview}
          onConfirm={handleConfirm}
          onCancel={() => setPreview(null)}
          saving={saving}
        />
      )}

      <div className="min-h-screen bg-zinc-950">
        <AppNav />

        <main id="main" className="page-shell !pt-1">
          <h1 className="sr-only">Portfolio</h1>
          <div className="flex items-center justify-between gap-2 mb-2 shrink-0">
            <p
              className={cn(
                'type-meta tabular-nums min-w-0 truncate',
                syncedLabel ? 'text-zinc-500' : 'text-muted',
              )}
            >
              {syncedLabel ? `Synced ${syncedLabel}` : 'No holdings synced yet'}
            </p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-zinc-800 active:scale-[0.95] active:bg-zinc-700 text-zinc-300 text-sm font-semibold transition-all shrink-0 [touch-action:manipulation]"
            >
              <Upload className="w-3.5 h-3.5" />
              Sync
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={handleFileChange}
          />

          {parseError && (
            <div className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 mb-4">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{parseError}</p>
            </div>
          )}

          {/* Content */}
          {portfolioPending ? (
            <>
              <PortfolioSummarySkeleton />
              <PortfolioDailySummary holdingCount={0} pending />
              <HoldingsSection
                holdings={[]}
                countdown={0}
                refreshing={false}
                marketOpen={marketOpen}
                loading
              />
            </>
          ) : holdings.length === 0 ? (
            <div className="pt-2 pb-12 space-y-4">
              <div className="flex items-start gap-3 bg-zinc-900 rounded-2xl px-4 py-4">
                <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Upload className="w-4 h-4 text-blue-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white mb-1">How to sync Vested</p>
                  <ol className="text-xs text-zinc-400 space-y-1 list-none">
                    <li><span className="text-muted mr-1.5">1.</span>Open the <span className="text-zinc-200 font-medium">Vested Finance</span> app</li>
                    <li><span className="text-muted mr-1.5">2.</span>Go to <span className="text-zinc-200 font-medium">Portfolio → Download Holdings</span></li>
                    <li><span className="text-muted mr-1.5">3.</span>Save the <span className="text-zinc-200 font-medium">.xlsx</span> file and tap <span className="text-zinc-200 font-medium">Sync</span> above</li>
                  </ol>
                </div>
              </div>

              <div className="text-center pt-8">
                <div className="w-16 h-16 rounded-3xl bg-zinc-900 flex items-center justify-center mx-auto mb-4">
                  <PieChart className="w-7 h-7 text-zinc-700" />
                </div>
                <p className="text-white text-base font-semibold mb-1">No holdings yet</p>
                <p className="text-zinc-500 text-sm max-w-[200px] mx-auto">Upload your XLSX file to see your portfolio here.</p>
              </div>
            </div>
          ) : (
            <>
              <SummaryBar holdings={holdings} />

              <PortfolioDailySummary holdingCount={holdings.length} />

              <HoldingsSection
                holdings={holdings}
                countdown={countdown}
                refreshing={refreshing}
                marketOpen={marketOpen}
              />
            </>
          )}
        </main>
      </div>
    </>
  )
}
