'use client'

import { useCallback, useRef, useState } from 'react'
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
  ChevronDown,
  Eye,
} from 'lucide-react'
import AppNav from '@/components/AppNav'
import StockLogo from '@/components/StockLogo'
import LiveRefreshHeader from '@/components/LiveRefreshHeader'
import { useMarketOpen, useMarketSession } from '@/hooks/useMarketOpen'
import { useLivePriceRefresh } from '@/hooks/useLivePriceRefresh'
import { PORTFOLIO_ALERT_DEMO } from '@/lib/portfolio-alerts'
import { createMarketAwareFetcher } from '@/lib/swr-market-fetcher'
import type { MarketSession } from '@/lib/market-hours'
import { formatSnapshotAsOfET } from '@/lib/market-hours'
import { cn } from '@/lib/utils'
import type {
  PortfolioAlert,
  PortfolioAlertsResponse,
  PortfolioHoldingWithPrice,
  PickFactor,
  VestedRow,
} from '@/types'

const portfolioFetcher = createMarketAwareFetcher<PortfolioHoldingWithPrice>()

const fetcher = async (url: string) => {
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
    <div className="card-surface px-4 py-3 mb-4">
      <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.1em] mb-1">Portfolio Value</p>
      <div className="flex items-end justify-between gap-2">
        <div>
          <p className="text-2xl font-black text-white tabular-nums leading-none">${fmt(totalCurrent)}</p>
          {asOfLabel && (
            <p className="text-[10px] text-zinc-600 mt-1">{asOfLabel}</p>
          )}
        </div>
        <span className={cn(
          'text-xs font-bold px-2 py-0.5 rounded-full shrink-0',
          isPos ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
        )}>
          {isPos ? '+' : ''}{fmt(pnlPct)}%
        </span>
      </div>

      <div className="mt-2 flex items-center justify-between pt-2 border-t border-white/[0.06] gap-3">
        <div>
          <p className="text-[10px] text-zinc-500">Invested</p>
          <p className="text-sm font-bold text-zinc-200 tabular-nums leading-tight">${fmt(totalInvested)}</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] text-zinc-500">Total P&L</p>
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
  )
}

// ── Holding card ──────────────────────────────────────────────────────────────
function HoldingCard({ h }: { h: PortfolioHoldingWithPrice }) {
  const price = h.snapshot?.price ?? null
  const currentValue = price != null ? price * h.quantity : null
  const invested = h.avg_cost_basis * h.quantity
  const pnl = currentValue != null ? currentValue - invested : null
  const pnlPct = invested && pnl != null ? (pnl / invested) * 100 : null
  const isPos = pnl != null ? pnl >= 0 : null
  const change1d = h.snapshot?.change_1d_pct ?? null

  return (
    <div className="card-surface px-5 py-4 flex items-center gap-3 active:scale-[0.99] active:brightness-95 transition-all duration-100">
      <StockLogo ticker={h.ticker} size="md" />
      {/* Left: identity */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[15px] font-bold text-white tracking-tight">{h.ticker}</span>
          <span className="text-xs text-zinc-500 truncate">{h.company_name ?? ''}</span>
        </div>
        <p className="text-xs text-zinc-400 mt-0.5 tabular-nums">
          {fmt(h.quantity, 0)} shares · avg ${fmt(h.avg_cost_basis)} · inv ${fmt(invested)}
        </p>
      </div>

      {/* Right: price + P&L */}
      <div className="text-right shrink-0">
        <div className="flex items-baseline justify-end gap-1.5">
          <span className="text-[15px] font-bold text-white tabular-nums">
            {price != null ? `$${fmt(price)}` : '—'}
          </span>
        </div>
        {change1d != null && (
          <p className={cn('text-xs tabular-nums font-semibold mt-0.5', change1d >= 0 ? 'text-emerald-400' : 'text-red-400')}>
            {change1d >= 0 ? '+' : ''}{fmt(change1d)}%
          </p>
        )}
        {pnl != null && pnlPct != null && (
          <p className={cn('text-xs tabular-nums font-semibold mt-0.5', isPos ? 'text-emerald-400' : 'text-red-400')}>
            {isPos ? '+' : '-'}${fmt(Math.abs(pnl))} ({isPos ? '+' : ''}{fmt(pnlPct)}%)
          </p>
        )}
      </div>
    </div>
  )
}

// ── Alert factor chip ─────────────────────────────────────────────────────────
function AlertFactorChip({ factor }: { factor: PickFactor }) {
  const tone =
    factor.tone === 'negative' ? 'bg-red-500/10 text-red-300' :
    factor.tone === 'positive' ? 'bg-emerald-500/10 text-emerald-300' :
    'bg-zinc-800 text-zinc-400'
  return (
    <span className={cn('text-[11px] font-semibold px-2 py-1 rounded-full whitespace-nowrap', tone)}>
      {factor.label}
      {factor.value && <span className="opacity-70 ml-1 font-normal">· {factor.value}</span>}
    </span>
  )
}

// ── Portfolio review alert card ───────────────────────────────────────────────
function AlertCard({ alert, preview }: { alert: PortfolioAlert; preview?: boolean }) {
  const [open, setOpen] = useState(false)
  const isRed = alert.severity === 'red'
  const pnl = alert.holding.position_pnl_pct
  const isPos = pnl >= 0

  return (
    <div
      className={cn(
        'rounded-2xl overflow-hidden border',
        isRed ? 'bg-red-950/30 border-red-500/25' : 'bg-amber-950/20 border-amber-500/20',
        preview && 'opacity-90',
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left px-4 py-4 active:brightness-95 transition-all [touch-action:manipulation]"
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-start gap-2 min-w-0 flex-1">
            <StockLogo ticker={alert.ticker} size="sm" className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold text-white">{alert.ticker}</span>
                <span className="text-xs text-zinc-500 truncate">{alert.company_name ?? ''}</span>
              </div>
              <p className={cn('text-xs mt-0.5 leading-snug', isRed ? 'text-red-200/90' : 'text-amber-200/80')}>
                {alert.headline}
              </p>
            </div>
          </div>
          <span
            className={cn(
              'shrink-0 whitespace-nowrap text-[11px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-full',
              isRed ? 'bg-red-500/20 text-red-300' : 'bg-amber-500/15 text-amber-300',
            )}
          >
            {isRed ? 'Review' : 'Watch'}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 bg-black/20 rounded-xl px-3 py-2.5">
          <div>
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Your P&L</p>
            <p className={cn('text-sm font-bold tabular-nums', isPos ? 'text-emerald-400' : 'text-red-400')}>
              {isPos ? '+' : ''}{pnl.toFixed(1)}%
            </p>
            <p className="text-[11px] text-zinc-500 tabular-nums">avg ${fmt(alert.holding.avg_cost_basis)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wide">Now</p>
            <p className="text-sm font-bold text-white tabular-nums">${fmt(alert.holding.current_price)}</p>
            <p className="text-[11px] text-zinc-500 tabular-nums">{fmt(alert.holding.quantity, 0)} shares</p>
          </div>
        </div>

        {alert.factors.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {alert.factors.map((f, i) => (
              <AlertFactorChip key={i} factor={f} />
            ))}
          </div>
        )}

        <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/[0.06]">
          <span className="text-[11px] text-zinc-500 font-medium">
            {open ? 'Hide review' : 'Why review this holding?'}
          </span>
          <ChevronDown
            className={cn('w-4 h-4 text-zinc-600 transition-transform', open && 'rotate-180')}
            aria-hidden="true"
          />
        </div>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-0 space-y-3">
          {alert.review_reason && (
            <p className="text-sm text-zinc-200 leading-relaxed">{alert.review_reason}</p>
          )}
          {alert.caveat && (
            <p className="text-xs text-zinc-500 leading-relaxed border-l-2 border-zinc-700 pl-3">
              {alert.caveat}
            </p>
          )}
          <p className="text-[10px] text-zinc-600">
            {preview
              ? 'Sample card for UI preview'
              : alert.narrative_source === 'llm'
                ? 'Summary by AI · based on your cost and market data'
                : 'Summary from matched signals · based on your cost and market data'}
          </p>
        </div>
      )}
    </div>
  )
}

function AlertsSection({
  alerts,
  clearCount,
  holdingCount,
  preview,
  llmEnabled,
  loading,
}: {
  alerts: PortfolioAlert[]
  clearCount: number
  holdingCount: number
  preview?: boolean
  llmEnabled?: boolean
  loading?: boolean
}) {
  if (!preview && holdingCount === 0) return null

  return (
    <section className="mb-4" aria-label="Portfolio review alerts">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div>
          <h2 className="text-sm font-bold text-white">Portfolio review</h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            {preview
              ? 'Sample alerts (not your portfolio)'
              : loading
                ? `Scanning ${holdingCount} holding${holdingCount === 1 ? '' : 's'}…`
                : alerts.length
                  ? `${alerts.length} worth a calm review · ${clearCount} look OK`
                  : `Scanned ${holdingCount} holding${holdingCount === 1 ? '' : 's'} — none need review`}
          </p>
        </div>
        {!preview && !loading && clearCount > 0 && alerts.length > 0 && (
          <span className="text-[11px] text-emerald-400/90 font-semibold shrink-0">
            {clearCount} OK
          </span>
        )}
      </div>

      {preview && (
        <p className="text-[11px] text-amber-400/80 mb-2 px-0.5">
          Preview only — sync Vested to scan your real holdings.
        </p>
      )}

      {loading ? (
        <div className="rounded-2xl bg-zinc-900 px-4 py-5 animate-pulse" aria-busy="true">
          <div className="h-3 w-40 bg-zinc-800 rounded mb-2" />
          <div className="h-3 w-full bg-zinc-800/80 rounded" />
        </div>
      ) : alerts.length > 0 ? (
        <ul className="space-y-2.5">
          {alerts.map((a) => (
            <li key={a.ticker}>
              <AlertCard alert={a} preview={preview} />
            </li>
          ))}
        </ul>
      ) : !preview ? (
        <div className="rounded-xl bg-emerald-500/5 border border-emerald-500/15 px-3.5 py-3 flex items-start gap-2.5">
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 text-left">
            <p className="text-sm font-semibold text-emerald-300/90 leading-tight">All clear for now</p>
            <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">
              No holdings need review—we flag only when several weak signals line up.
            </p>
          </div>
        </div>
      ) : null}

      {!preview && !loading && holdingCount > 0 && (
        <p className="text-[10px] text-zinc-600 mt-2 leading-snug px-0.5">
          Tap ↻ to rescan.{llmEnabled ? ' AI summaries when available.' : ''}
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
    data: holdings = [],
    isLoading,
    isValidating,
    mutate,
  } = useSWR<PortfolioHoldingWithPrice[]>('/api/portfolio', portfolioFetcher, {
    revalidateOnFocus: false,
    onSuccess: (data) => {
      if (data?.length) setSavedAt(data[0].synced_at)
    },
  })

  const {
    data: alertsData,
    isLoading: alertsLoading,
    mutate: mutateAlerts,
  } = useSWR<PortfolioAlertsResponse>(
    holdings.length > 0 ? '/api/portfolio/alerts' : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 0 },
  )

  const refreshing = manualRefresh || (isValidating && !isLoading)

  const handleRefresh = useCallback(async () => {
    if (!marketOpen) return
    setManualRefresh(true)
    try {
      await mutate()
      if (holdings.length > 0) {
        const fresh = await fetch('/api/portfolio/alerts?refresh=1', { cache: 'no-store' })
        if (fresh.ok) {
          const json = (await fresh.json()) as PortfolioAlertsResponse
          await mutateAlerts(json, { revalidate: false })
        } else {
          await mutateAlerts()
        }
      }
    } finally {
      setManualRefresh(false)
    }
  }, [holdings.length, marketOpen, mutate, mutateAlerts])

  const refreshPrices = useCallback(() => {
    void mutate()
    if (holdings.length > 0) void mutateAlerts()
  }, [holdings.length, mutate, mutateAlerts])

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

        <main id="main" className="page-shell">
          {/* Header */}
          <div className="flex items-start justify-between mb-5 gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="page-title">Portfolio</h1>
              {syncedLabel ? (
                <div className="flex items-center gap-1.5 mt-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                  <p className="text-xs text-zinc-400 font-medium">Vested synced <span className="text-zinc-300">{syncedLabel}</span></p>
                </div>
              ) : (
                <p className="text-xs text-zinc-600 mt-2">No holdings synced yet</p>
              )}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3.5 h-9 rounded-xl bg-zinc-800 active:scale-[0.95] active:bg-zinc-700 text-zinc-300 text-sm font-semibold transition-all [touch-action:manipulation] shrink-0 mt-1"
            >
              <Upload className="w-3.5 h-3.5" />
              Sync
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          {parseError && (
            <div className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5 mb-4">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{parseError}</p>
            </div>
          )}

          {/* Content */}
          {isLoading ? (
            <div className="space-y-2.5" aria-busy="true">
              <div className="h-[88px] rounded-2xl bg-zinc-900 animate-pulse mb-1" />
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-[62px] rounded-2xl bg-zinc-900 animate-pulse" style={{ animationDelay: `${n * 80}ms` }} />
              ))}
            </div>
          ) : holdings.length === 0 ? (
            <div className="pt-2 pb-12 space-y-4">
              {showPreview ? (
                <AlertsSection
                  alerts={PORTFOLIO_ALERT_DEMO}
                  clearCount={0}
                  holdingCount={0}
                  preview
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowPreview(true)}
                  className="w-full flex items-center justify-center gap-2 h-11 rounded-xl bg-zinc-900 text-zinc-300 text-sm font-semibold active:scale-[0.98] transition-all [touch-action:manipulation]"
                >
                  <Eye className="w-4 h-4 text-zinc-500" aria-hidden="true" />
                  Preview sample review alerts
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
                    <li><span className="text-zinc-600 mr-1.5">1.</span>Open the <span className="text-zinc-200 font-medium">Vested Finance</span> app</li>
                    <li><span className="text-zinc-600 mr-1.5">2.</span>Go to <span className="text-zinc-200 font-medium">Portfolio → Download Holdings</span></li>
                    <li><span className="text-zinc-600 mr-1.5">3.</span>Save the <span className="text-zinc-200 font-medium">.xlsx</span> file and tap <span className="text-zinc-200 font-medium">Sync</span> above</li>
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

              <AlertsSection
                alerts={alertsData?.alerts ?? []}
                clearCount={alertsData?.clear_count ?? holdings.length}
                holdingCount={alertsData?.holding_count ?? holdings.length}
                llmEnabled={alertsData?.llm_enabled}
                loading={alertsLoading && !alertsData}
              />

              <LiveRefreshHeader
                title="Your holdings"
                seconds={countdown}
                refreshing={refreshing}
                session={marketSession}
              />

              <div className="space-y-2">
                {holdings.map((h) => (
                  <HoldingCard key={h.id} h={h} />
                ))}
              </div>
            </>
          )}
        </main>
      </div>
    </>
  )
}
