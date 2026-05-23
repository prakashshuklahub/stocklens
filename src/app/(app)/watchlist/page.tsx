'use client'

import { useCallback, useState, useEffect, useMemo } from 'react'
import useSWR from 'swr'
import { TrendingUp, ChevronDown } from 'lucide-react'
import WatchlistCard, { type WatchlistStock } from '@/components/watchlist/WatchlistCard'
import StockSearchInput, { type StockResult } from '@/components/watchlist/StockSearchInput'
import WatchlistSuggestions from '@/components/watchlist/WatchlistSuggestions'
import AppNav from '@/components/AppNav'
import LiveRefreshHeader from '@/components/LiveRefreshHeader'
import { useMarketOpen, useMarketSession } from '@/hooks/useMarketOpen'
import { useLivePriceRefresh } from '@/hooks/useLivePriceRefresh'
import { createMarketAwareFetcher } from '@/lib/swr-market-fetcher'
import {
  computeTargetUpsidePct,
  hasDisplayTargetPrice,
} from '@/lib/target-price-display'
import { cn } from '@/lib/utils'
import type { MarketSession } from '@/lib/market-hours'
import type { StockFundamentals } from '@/types'

// Deterministic sector order
const SECTOR_ORDER = [
  'Technology',
  'Healthcare',
  'Consumer Discretionary',
  'Consumer Staples',
  'Financials',
  'Industrials',
  'Energy',
  'Real Estate',
  'Communication Services',
  'Materials',
  'Utilities',
  'Other',
]

type WatchlistSort = 'sector' | 'day_change' | 'target_upside' | 'alphabetical'

const SORT_STORAGE_KEY = 'watchlist-sort'

function loadSortMode(): WatchlistSort {
  if (typeof window === 'undefined') return 'sector'
  const saved = sessionStorage.getItem(SORT_STORAGE_KEY)
  if (
    saved === 'day_change' ||
    saved === 'target_upside' ||
    saved === 'alphabetical' ||
    saved === 'sector'
  ) {
    return saved
  }
  return 'sector'
}

function sortByDailyChange(stocks: WatchlistStock[]): WatchlistStock[] {
  return [...stocks].sort((a, b) => {
    const ac = a.snapshot?.change_1d_pct ?? -Infinity
    const bc = b.snapshot?.change_1d_pct ?? -Infinity
    return bc - ac // highest gainer first
  })
}

function sortAlphabetical(stocks: WatchlistStock[]): WatchlistStock[] {
  return [...stocks].sort((a, b) => a.ticker.localeCompare(b.ticker))
}

function targetUpsidePct(
  stock: WatchlistStock,
  fundamentalsByTicker: Record<string, StockFundamentals>,
): number {
  const f = fundamentalsByTicker[stock.ticker]
  if (!f || !hasDisplayTargetPrice(f.target_price, f.target_source)) return -Infinity
  return computeTargetUpsidePct(f.target_price, stock.snapshot?.price ?? null) ?? -Infinity
}

function sortByTargetUpside(
  stocks: WatchlistStock[],
  fundamentalsByTicker: Record<string, StockFundamentals>,
): WatchlistStock[] {
  return [...stocks].sort(
    (a, b) => targetUpsidePct(b, fundamentalsByTicker) - targetUpsidePct(a, fundamentalsByTicker),
  )
}

function WatchlistSortBar({
  value,
  onChange,
}: {
  value: WatchlistSort
  onChange: (mode: WatchlistSort) => void
}) {
  const options: { id: WatchlistSort; label: string }[] = [
    { id: 'sector', label: 'Sector' },
    { id: 'day_change', label: 'Day %' },
    { id: 'target_upside', label: 'Target upside' },
    { id: 'alphabetical', label: 'A–Z' },
  ]

  return (
    <div
      className="flex items-center flex-nowrap gap-x-0 mt-2.5"
      role="group"
      aria-label="Sort watchlist"
    >
      {options.map((opt, i) => {
        const active = value === opt.id
        return (
          <span key={opt.id} className="inline-flex items-center shrink-0">
            {i > 0 && (
              <span className="text-zinc-700 px-0.5 select-none text-xs" aria-hidden>
                ·
              </span>
            )}
            <button
              type="button"
              aria-pressed={active}
              onClick={() => onChange(opt.id)}
              className={cn(
                'relative min-h-[44px] px-1.5 text-sm transition-colors [touch-action:manipulation]',
                'after:absolute after:left-1.5 after:right-1.5 after:bottom-2 after:h-0.5 after:rounded-full after:transition-opacity',
                active
                  ? 'text-zinc-300 font-semibold after:bg-zinc-500/80 after:opacity-100'
                  : 'text-zinc-500 after:opacity-0 active:text-zinc-400',
              )}
            >
              {opt.label}
            </button>
          </span>
        )
      })}
    </div>
  )
}

function StockList({
  stocks,
  onRemove,
  marketSession,
  fundamentalsByTicker,
  fundamentalsLoading,
}: {
  stocks: WatchlistStock[]
  onRemove: (ticker: string) => void
  marketSession: MarketSession
  fundamentalsByTicker: Record<string, StockFundamentals>
  fundamentalsLoading: boolean
}) {
  return (
    <ul className="space-y-3" aria-label="Watchlist stocks">
      {stocks.map((stock) => (
        <li key={stock.id}>
          <WatchlistCard
            stock={stock}
            onRemove={onRemove}
            marketSession={marketSession}
            fundamentals={fundamentalsByTicker[stock.ticker] ?? null}
            fundamentalsLoading={fundamentalsLoading}
          />
        </li>
      ))}
    </ul>
  )
}

function groupBySector(stocks: WatchlistStock[]): [string, WatchlistStock[]][] {
  const map = new Map<string, WatchlistStock[]>()
  for (const stock of stocks) {
    const sector = stock.sector?.trim() || 'Other'
    if (!map.has(sector)) map.set(sector, [])
    map.get(sector)!.push(stock)
  }
  // Sort sectors by defined order, then alphabetically for unknowns
  // Within each sector, sort by daily change descending (top gainer → top loser)
  return [...map.entries()]
    .sort(([a], [b]) => {
      const ai = SECTOR_ORDER.indexOf(a)
      const bi = SECTOR_ORDER.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    .map(([sector, sectorStocks]) => [sector, sortByDailyChange(sectorStocks)])
}

function SectorGroup({
  sector,
  stocks,
  onRemove,
  marketSession,
  fundamentalsByTicker,
  fundamentalsLoading,
  defaultOpen = true,
}: {
  sector: string
  stocks: WatchlistStock[]
  onRemove: (ticker: string) => void
  marketSession: MarketSession
  fundamentalsByTicker: Record<string, StockFundamentals>
  fundamentalsLoading: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = `sector-${sector.replace(/\s+/g, '-').toLowerCase()}`

  return (
    <section aria-labelledby={id}>
      <button
        type="button"
        id={id}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-0.5 min-h-[44px] focus-visible:outline-none [touch-action:manipulation]"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-[0.1em]">
            {sector}
          </span>
          <span className="text-xs tabular-nums text-zinc-600 font-medium">
            {stocks.length}
          </span>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'w-3.5 h-3.5 text-zinc-600 transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90'
          )}
        />
      </button>

      {open && (
        <ul id={`${id}-list`} className="space-y-3 mt-2 mb-6" aria-label={`${sector} stocks`}>
          {stocks.map((stock) => (
            <li key={stock.id}>
              <WatchlistCard
                stock={stock}
                onRemove={onRemove}
                marketSession={marketSession}
                fundamentals={fundamentalsByTicker[stock.ticker] ?? null}
                fundamentalsLoading={fundamentalsLoading}
              />
            </li>
          ))}
        </ul>
      )}

      {!open && <div className="mb-3" />}
    </section>
  )
}

const watchlistFetcher = createMarketAwareFetcher<WatchlistStock>()
const BATCH_CHUNK = 40

async function fundamentalsBatchFetcher(url: string): Promise<{
  fundamentals: Record<string, StockFundamentals>
  refreshing: boolean
}> {
  const tickers =
    new URL(url, window.location.origin).searchParams.get('tickers')?.split(',').filter(Boolean) ?? []

  const chunks: string[] = []
  for (let i = 0; i < tickers.length; i += BATCH_CHUNK) {
    chunks.push(tickers.slice(i, i + BATCH_CHUNK).join(','))
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({ tickers: chunk })
      const res = await fetch(`/api/fundamentals/batch?${params}`)
      if (!res.ok) return null
      return res.json() as Promise<{
        fundamentals?: Record<string, StockFundamentals>
        refreshing?: boolean
      }>
    }),
  )

  const fundamentals: Record<string, StockFundamentals> = {}
  let refreshing = false
  for (const data of results) {
    if (!data) continue
    Object.assign(fundamentals, data.fundamentals ?? {})
    if (data.refreshing) refreshing = true
  }
  return { fundamentals, refreshing }
}

export default function WatchlistPage() {
  const marketOpen = useMarketOpen()
  const marketSession = useMarketSession()

  const { data: stocks = [], isLoading, isValidating, mutate } = useSWR<WatchlistStock[]>(
    '/api/watchlist',
    watchlistFetcher,
    { revalidateOnFocus: false },
  )

  const tickerKey =
    stocks.length > 0
      ? `/api/fundamentals/batch?tickers=${stocks.map((s) => s.ticker).join(',')}`
      : null

  const {
    data: fundamentalsBatch,
    isLoading: fundamentalsLoading,
    mutate: mutateFundamentals,
  } = useSWR<{
    fundamentals: Record<string, StockFundamentals>
    refreshing: boolean
  }>(tickerKey, fundamentalsBatchFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60_000,
    refreshInterval: (latest) => (latest?.refreshing ? 10_000 : 0),
  })

  const fundamentalsByTicker = fundamentalsBatch?.fundamentals ?? {}
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [suggestionsRefresh, setSuggestionsRefresh] = useState(0)
  const [sortMode, setSortMode] = useState<WatchlistSort>('sector')

  const refreshing = isValidating && !isLoading

  const refreshPrices = useCallback(() => {
    void mutate()
    void mutateFundamentals()
  }, [mutate, mutateFundamentals])

  const countdown = useLivePriceRefresh(
    marketSession,
    marketOpen && stocks.length > 0,
    refreshPrices,
  )

  useEffect(() => {
    setSortMode(loadSortMode())
  }, [])

  useEffect(() => {
    sessionStorage.setItem(SORT_STORAGE_KEY, sortMode)
  }, [sortMode])

  const layout = useMemo(() => {
    if (sortMode === 'sector') {
      return { type: 'sector' as const, groups: groupBySector(stocks) }
    }
    if (sortMode === 'day_change') {
      return { type: 'flat' as const, stocks: sortByDailyChange(stocks) }
    }
    if (sortMode === 'target_upside') {
      return {
        type: 'flat' as const,
        stocks: sortByTargetUpside(stocks, fundamentalsByTicker),
      }
    }
    return { type: 'flat' as const, stocks: sortAlphabetical(stocks) }
  }, [stocks, sortMode, fundamentalsByTicker])

  async function handleAdd(result: StockResult) {
    setError('')
    setAdding(true)
    try {
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: result.ticker,
          company_name: result.company_name,
          sector: result.sector ?? '',
        }),
      })
      if (!res.ok) {
        const d = await res.json()
        setError(d.error ?? 'Failed to add stock')
        return
      }
      await mutate()
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(ticker: string) {
    const sym = ticker.toUpperCase()
    setError('')
    const res = await fetch(`/api/watchlist/${encodeURIComponent(sym)}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string }
      setError(d.error ?? 'Failed to remove stock')
      await mutate()
      return
    }
    await mutate(
      (current) => (current ?? []).filter((s) => s.ticker.toUpperCase() !== sym),
      { revalidate: false },
    )
    void mutateFundamentals()
  }

  const ownedTickers = new Set(stocks.map((s) => s.ticker.toUpperCase()))

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:bg-zinc-800 focus:text-white focus:rounded-lg focus:text-sm"
      >
        Skip to main content
      </a>

      <div className="min-h-screen bg-zinc-950">
        <AppNav
          onRefresh={() => {
            refreshPrices()
            if (marketOpen) setSuggestionsRefresh((n) => n + 1)
          }}
          refreshing={refreshing}
          marketOpen={marketOpen}
          showRefresh
        />

        {/* Main — bottom padding clears fixed bottom tab bar + safe area */}
        <main id="main" className="page-shell">
          <div className="flex items-end justify-between mb-6">
            <h1 className="page-title">Watchlist</h1>
            {!isLoading && stocks.length > 0 && (
              <span className="text-sm text-zinc-500 tabular-nums mb-1" aria-live="polite">
                {stocks.length} stocks
              </span>
            )}
          </div>

          {/* Search */}
          <div className="mb-6" role="search">
            <StockSearchInput onSelect={handleAdd} disabled={adding} />
            {adding && (
              <p className="text-xs text-zinc-500 mt-2 text-center" aria-live="polite">Adding…</p>
            )}
            {error && (
              <p className="text-xs text-red-400 mt-2" aria-live="polite" role="alert">{error}</p>
            )}
          </div>

          <WatchlistSuggestions
            ownedTickers={ownedTickers}
            onAdd={handleAdd}
            adding={adding}
            refreshToken={suggestionsRefresh}
            marketOpen={marketOpen}
          />

          {/* Content */}
          {isLoading ? (
            <div className="space-y-5" aria-busy="true" aria-label="Loading watchlist">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-[120px] rounded-2xl bg-zinc-900 animate-pulse" style={{ animationDelay: `${n * 80}ms` }} />
              ))}
            </div>
          ) : stocks.length === 0 ? (
            <div className="text-center py-28">
              <div className="w-16 h-16 rounded-3xl bg-zinc-900 flex items-center justify-center mx-auto mb-5" aria-hidden="true">
                <TrendingUp className="w-7 h-7 text-zinc-700" aria-hidden="true" />
              </div>
              <p className="text-white text-base font-semibold mb-1">Your watchlist is empty</p>
              <p className="text-zinc-500 text-sm [text-wrap:pretty] max-w-[220px] mx-auto">Search for a stock above to start tracking it.</p>
            </div>
          ) : (
            <div>
              <LiveRefreshHeader
                title="Your watchlist"
                seconds={countdown}
                refreshing={refreshing}
                session={marketSession}
                footer={
                  <WatchlistSortBar value={sortMode} onChange={setSortMode} />
                }
              />

              {layout.type === 'sector' ? (
                layout.groups.map(([sector, sectorStocks]) => (
                  <SectorGroup
                    key={sector}
                    sector={sector}
                    stocks={sectorStocks}
                    onRemove={handleRemove}
                    marketSession={marketSession}
                    fundamentalsByTicker={fundamentalsByTicker}
                    fundamentalsLoading={fundamentalsLoading}
                    defaultOpen
                  />
                ))
              ) : (
                <StockList
                  stocks={layout.stocks}
                  onRemove={handleRemove}
                  marketSession={marketSession}
                  fundamentalsByTicker={fundamentalsByTicker}
                  fundamentalsLoading={fundamentalsLoading}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </>
  )
}
