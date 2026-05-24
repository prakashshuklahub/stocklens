'use client'

import { useCallback, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import * as XLSX from 'xlsx'
import {
  PieChart,
  Upload,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  X,
  AlertCircle,
  Eye,
} from 'lucide-react'
import AppNav from '@/components/AppNav'
import StockLogo from '@/components/StockLogo'
import { HoldingCard } from '@/components/portfolio/HoldingCard'
import { RefreshCountdown } from '@/components/LiveRefreshHeader'
import { useMarketOpen, useMarketSession } from '@/hooks/useMarketOpen'
import { useLivePriceRefresh } from '@/hooks/useLivePriceRefresh'
import { PORTFOLIO_ALERT_DEMO } from '@/lib/portfolio-alerts'
import { mergePriceSnapshots } from '@/lib/portfolio-signals'
import type { MarketSession } from '@/lib/market-hours'
import { formatSnapshotAsOfET, liveRefreshSubtitle } from '@/lib/market-hours'
import { cn } from '@/lib/utils'
import type {
  HoldingSignalTier,
  PortfolioAlert,
  PortfolioHoldingWithPrice,
  PortfolioHoldingWithSignal,
  PortfolioSignalsMeta,
  PortfolioWithSignalsResponse,
  VestedRow,
} from '@/types'

type TierFilter = 'all' | 'attention' | 'soft' | 'profit' | 'quiet'

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
function SummaryBar({
  holdings,
  session,
}: {
  holdings: PortfolioHoldingWithPrice[]
  session: MarketSession
}) {
  let totalInvested = 0
  let totalCurrent = 0
  let latestAsOf: number | null = null

  for (const h of holdings) {
    totalInvested += h.avg_cost_basis * h.quantity
    const price = h.snapshot?.price
    if (price != null) {
      totalCurrent += price * h.quantity
      const asOf = h.snapshot?.as_of
      if (asOf != null && (latestAsOf == null || asOf > latestAsOf)) latestAsOf = asOf
    }
  }

  const pnl = totalCurrent - totalInvested
  const pnlPct = totalInvested ? (pnl / totalInvested) * 100 : 0
  const isPos = pnl >= 0
  const asOfLabel = session === 'closed' ? formatSnapshotAsOfET(latestAsOf) : null

  return (
    <div className="portfolio-summary mb-4">
      <div className="portfolio-summary-inner px-4 py-3">
        <p className="type-micro font-semibold text-blue-400/55 uppercase tracking-[0.1em] mb-1">Portfolio Value</p>
        <div className="flex items-end justify-between gap-2">
          <div>
            <p className="text-2xl font-black text-white tabular-nums leading-none">${fmt(totalCurrent)}</p>
            {asOfLabel && (
              <p className="type-micro text-muted mt-1">{asOfLabel}</p>
            )}
          </div>
          <span className={cn(
            'text-xs font-bold px-2 py-0.5 rounded-full shrink-0',
            isPos ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
          )}>
            {isPos ? '+' : ''}{fmt(pnlPct)}%
          </span>
        </div>

        <div className="mt-2 flex items-center justify-between pt-2 border-t border-white/[0.06] gap-3">
          <div>
            <p className="type-micro text-zinc-500">Invested</p>
            <p className="text-sm font-bold text-zinc-200 tabular-nums leading-tight">${fmt(totalInvested)}</p>
          </div>
          <div className="text-right">
            <p className="type-micro text-zinc-500">Total P&L</p>
            <div className="flex items-center justify-end gap-1">
              {isPos
                ? <TrendingUp className="w-3 h-3 text-emerald-400" />
                : <TrendingDown className="w-3 h-3 text-red-400" />}
              <p className={cn('text-sm font-bold tabular-nums leading-tight', isPos ? 'text-emerald-400' : 'text-red-400')}>
                {isPos ? '+' : '-'}${fmt(Math.abs(pnl))}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function alertToDemoHolding(alert: PortfolioAlert, index: number): PortfolioHoldingWithSignal {
  const tier: HoldingSignalTier =
    alert.headline.includes('target') || alert.factors.some((f) => f.label === 'Target in range')
      ? 'profit'
      : alert.severity === 'red'
        ? 'attention'
        : 'soft'

  return {
    id: `demo-${index}`,
    user_id: 'demo',
    ticker: alert.ticker,
    company_name: alert.company_name,
    quantity: alert.holding.quantity,
    avg_cost_basis: alert.holding.avg_cost_basis,
    broker: null,
    synced_at: new Date().toISOString(),
    snapshot: {
      price: alert.holding.current_price,
      change_1d_pct: 0,
      as_of: Date.now(),
    },
    signal: {
      tier,
      score: alert.score,
      headline: alert.headline,
      factors: alert.factors,
      review_reason: alert.review_reason,
      caveat: alert.caveat,
      narrative_source: alert.narrative_source,
    },
  }
}

const DEMO_HOLDINGS = PORTFOLIO_ALERT_DEMO.map(alertToDemoHolding)

function holdingsSignalsSubtitle(
  meta: PortfolioSignalsMeta | null | undefined,
  session: MarketSession,
  loading?: boolean,
): string {
  if (loading) return 'Scanning holdings…'
  if (!meta) return liveRefreshSubtitle(session)
  const flagged = meta.by_tier.attention + meta.by_tier.soft + meta.by_tier.profit
  if (flagged === 0) return `${meta.holding_count} holding${meta.holding_count === 1 ? '' : 's'} — all look quiet`
  return `${flagged} flagged · ${meta.quiet_count} look quiet`
}

const TIER_FILTERS: { id: TierFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'soft', label: 'Worth watching' },
  { id: 'profit', label: 'Target reached' },
  { id: 'quiet', label: 'Quiet' },
]

const PORTFOLIO_FLAG_HELP =
  'We flag holdings when price, news, or analyst views look weak, or when you may be near a profit target. Red tags are concerns; green tags are positives. Filters sort by how serious the flag is. Not buy or sell advice.'

function filterHoldings(holdings: PortfolioHoldingWithSignal[], filter: TierFilter): PortfolioHoldingWithSignal[] {
  if (filter === 'all') return holdings
  return holdings.filter((h) => h.signal.tier === filter)
}

function HoldingsSection({
  holdings,
  meta,
  countdown,
  refreshing,
  session,
  loading,
  preview,
}: {
  holdings: PortfolioHoldingWithSignal[]
  meta?: PortfolioSignalsMeta | null
  countdown: number
  refreshing: boolean
  session: MarketSession
  loading?: boolean
  preview?: boolean
}) {
  const [tierFilter, setTierFilter] = useState<TierFilter>('all')
  const isLive = session === 'regular'
  const filtered = useMemo(() => filterHoldings(holdings, tierFilter), [holdings, tierFilter])
  const subtitle = preview
    ? 'Sample flagged holdings (not your portfolio)'
    : holdingsSignalsSubtitle(meta, session, loading)

  return (
    <section className="mb-5" aria-label="Your holdings">
      <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
        <p className="type-caption text-zinc-500" aria-live="polite">
          {subtitle}
        </p>
        {isLive && !preview && (
          <RefreshCountdown seconds={countdown} refreshing={refreshing} />
        )}
      </div>

      {preview && (
        <p className="type-meta text-amber-400/80 mb-2 px-0.5">
          Preview only — sync Vested to scan your real holdings.
        </p>
      )}

      {!preview && holdings.length > 0 && (
        <>
          <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-0.5 px-0.5 scrollbar-none">
            {TIER_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setTierFilter(f.id)}
                className={cn(
                  'shrink-0 type-meta font-semibold px-3 py-1.5 rounded-full transition-colors [touch-action:manipulation]',
                  tierFilter === f.id
                    ? 'bg-zinc-700 text-white'
                    : 'bg-zinc-900 text-zinc-400 active:bg-zinc-800',
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
          <p className="type-meta text-muted leading-snug mb-2 px-0.5">
            {PORTFOLIO_FLAG_HELP}
          </p>
        </>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-[120px] rounded-2xl bg-zinc-900 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((h) => (
            <HoldingCard key={h.id} h={h} preview={preview} />
          ))}
          {filtered.length === 0 && tierFilter !== 'all' && (
            <p className="type-meta text-muted text-center py-6">
              No holdings in this category.
            </p>
          )}
        </div>
      )}

      {!preview && !loading && holdings.length > 0 && (
        <p className="type-micro text-muted mt-2 leading-snug px-0.5">
          Tap ↻ to rescan fundamentals during market hours.
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
  const [showPreview, setShowPreview] = useState(false)
  const [manualRefresh, setManualRefresh] = useState(false)

  const marketOpen = useMarketOpen()
  const marketSession = useMarketSession()

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
  const signalsMeta = portfolioData?.meta ?? null

  const refreshing = manualRefresh || (isValidating && !isLoading)

  const handleRefresh = useCallback(async () => {
    if (!marketOpen) return
    setManualRefresh(true)
    try {
      await mutate(
        async () => {
          const res = await fetch('/api/portfolio?include=signals&refresh=1', { cache: 'no-store' })
          if (!res.ok) throw new Error('Refresh failed')
          return res.json() as Promise<PortfolioWithSignalsResponse>
        },
        { revalidate: false },
      )
    } finally {
      setManualRefresh(false)
    }
  }, [marketOpen, mutate])

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
    marketSession,
    marketOpen && holdings.length > 0,
    refreshPrices,
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
        <AppNav
          onRefresh={handleRefresh}
          refreshing={refreshing}
          marketOpen={marketOpen}
          showRefresh={holdings.length > 0}
        />

        <main id="main" className="page-shell !pt-3">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-1.5 min-w-0">
              <h1 className="text-2xl sm:text-xl font-bold text-white tracking-tight">Portfolio</h1>
              <PieChart className="w-4 h-4 text-blue-400 shrink-0" aria-hidden="true" />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {syncedLabel && (
                <p className="type-meta text-zinc-500 tabular-nums hidden sm:block">
                  Synced {syncedLabel}
                </p>
              )}
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-zinc-800 active:scale-[0.95] active:bg-zinc-700 text-zinc-300 text-sm font-semibold transition-all [touch-action:manipulation]"
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
          </div>
          {syncedLabel ? (
            <p className="type-caption text-zinc-500 mb-4 -mt-2 sm:hidden">Synced {syncedLabel}</p>
          ) : (
            <p className="type-caption text-muted mb-4 -mt-2">No holdings synced yet</p>
          )}

          {parseError && (
            <div className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 mb-4">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{parseError}</p>
            </div>
          )}

          {/* Content */}
          {isLoading ? (
            <div className="space-y-3" aria-busy="true">
              <div className="portfolio-summary h-[100px] animate-pulse opacity-60 mb-4" />
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-[72px] rounded-2xl bg-zinc-900 animate-pulse" style={{ animationDelay: `${n * 80}ms` }} />
              ))}
            </div>
          ) : holdings.length === 0 ? (
            <div className="pt-2 pb-12 space-y-4">
              {showPreview ? (
                <HoldingsSection
                  holdings={DEMO_HOLDINGS}
                  preview
                  countdown={0}
                  refreshing={false}
                  session={marketSession}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowPreview(true)}
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-zinc-900 text-zinc-300 text-sm font-semibold active:scale-[0.98] transition-all [touch-action:manipulation]"
                >
                  <Eye className="w-4 h-4 text-zinc-500" aria-hidden="true" />
                  Preview sample flagged holdings
                </button>
              )}

              {showPreview && (
                <button
                  type="button"
                  onClick={() => setShowPreview(false)}
                  className="w-full text-center text-xs text-zinc-500 py-1 [touch-action:manipulation]"
                >
                  Hide preview
                </button>
              )}

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
              <SummaryBar holdings={holdings} session={marketSession} />

              <HoldingsSection
                holdings={holdings}
                meta={signalsMeta}
                countdown={countdown}
                refreshing={refreshing}
                session={marketSession}
                loading={isLoading && !portfolioData}
              />
            </>
          )}
        </main>
      </div>
    </>
  )
}
