'use client'

import { useCallback, useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import useSWR from 'swr'
import { TrendingUp, ChevronDown } from 'lucide-react'
import WatchlistCard, { type WatchlistStock } from '@/components/watchlist/WatchlistCard'
import StockSearchInput, { type StockResult } from '@/components/watchlist/StockSearchInput'
import WatchlistSuggestions from '@/components/watchlist/WatchlistSuggestions'
import AppNav from '@/components/AppNav'
import FilterChipBar, { type FilterChipOption } from '@/components/FilterChipBar'
import { useMarketOpen, useMarketSession } from '@/hooks/useMarketOpen'
import { RefreshCountdown } from '@/components/LiveRefreshHeader'
import { useLivePriceRefresh } from '@/hooks/useLivePriceRefresh'
import { createMarketAwareFetcher } from '@/lib/swr-market-fetcher'
import {
  computeTargetUpsidePct,
  hasDisplayTargetPrice,
} from '@/lib/target-price-display'
import { vsSectorSortKey } from '@/lib/sector-relative-strength'
import { cn } from '@/lib/utils'
import { compareSignalsByScore } from '@/lib/signals-scoring'
import type { FundamentalsBatchResponse, SectorBenchmark, SectorRelativeStrength, Signal, SignalsResponse, StockFundamentals } from '@/types'
import type { MarketSession } from '@/lib/market-hours'

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

type WatchlistSort = 'sector' | 'day_change' | 'target_upside' | 'alphabetical' | 'vs_sector' | 'bullish' | 'bearish'

const SORT_STORAGE_KEY = 'watchlist-sort'

function loadSortMode(): WatchlistSort {
  if (typeof window === 'undefined') return 'sector'
  const saved = sessionStorage.getItem(SORT_STORAGE_KEY)
  if (
    saved === 'day_change' ||
    saved === 'target_upside' ||
    saved === 'alphabetical' ||
    saved === 'sector' ||
    saved === 'vs_sector' ||
    saved === 'bullish' ||
    saved === 'bearish'
  ) {
    return saved
  }
  return 'sector'
}

function sortBySignalBias(
  stocks: WatchlistStock[],
  signalsByTicker: Map<string, Signal>,
  bias: 'bullish' | 'bearish',
): WatchlistStock[] {
  return stocks
    .filter((s) => signalsByTicker.get(s.ticker.toUpperCase())?.bias === bias)
    .sort((a, b) => {
      const sa = signalsByTicker.get(a.ticker.toUpperCase())!
      const sb = signalsByTicker.get(b.ticker.toUpperCase())!
      return compareSignalsByScore(sa, sb)
    })
}

function signalsByTickerFromResponse(data: SignalsResponse | undefined): Map<string, Signal> {
  const map = new Map<string, Signal>()
  if (!data) return map
  for (const s of [...data.bullish, ...data.bearish, ...data.quiet]) {
    map.set(s.ticker.toUpperCase(), s)
  }
  return map
}

const signalsFetcher = async (url: string): Promise<SignalsResponse> => {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('Request failed')
  return res.json()
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

function sortByVsSector(
  stocks: WatchlistStock[],
  vsSectorByTicker: FundamentalsBatchResponse['vs_sector'],
): WatchlistStock[] {
  return [...stocks].sort(
    (a, b) => vsSectorSortKey(vsSectorByTicker[b.ticker]) - vsSectorSortKey(vsSectorByTicker[a.ticker]),
  )
}

function WatchlistSortBar({
  value,
  onChange,
}: {
  value: WatchlistSort
  onChange: (mode: WatchlistSort) => void
}) {
  const options: FilterChipOption<WatchlistSort>[] = [
    { id: 'sector', label: 'Sector' },
    { id: 'day_change', label: 'Day %' },
    { id: 'bullish', label: 'Bullish', tone: 'bullish' },
    { id: 'bearish', label: 'Bearish', tone: 'bearish' },
    { id: 'vs_sector', label: 'Vs sector' },
    { id: 'target_upside', label: 'Room to grow' },
    { id: 'alphabetical', label: 'A–Z' },
  ]

  return (
    <FilterChipBar
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel="Sort watchlist"
    />
  )
}

function sectorBenchmarkForStock(
  stock: WatchlistStock,
  sectorBenchmarks: Record<string, SectorBenchmark>,
): SectorBenchmark | null {
  const sector = stock.sector?.trim()
  if (!sector || sector === 'Other') return null
  return sectorBenchmarks[sector] ?? null
}

function StockList({
  stocks,
  onRemove,
  marketSession,
  fundamentalsByTicker,
  fundamentalsLoading,
  vsSectorByTicker,
  sectorBenchmarks,
  regularChange1dByTicker,
  sectorBenchmarksRefreshing,
  signalsByTicker,
  signalsLoading,
}: {
  stocks: WatchlistStock[]
  onRemove: (ticker: string) => void
  marketSession: MarketSession
  fundamentalsByTicker: Record<string, StockFundamentals>
  fundamentalsLoading: boolean
  vsSectorByTicker: Record<string, SectorRelativeStrength>
  sectorBenchmarks: Record<string, SectorBenchmark>
  regularChange1dByTicker: Record<string, number>
  sectorBenchmarksRefreshing: boolean
  signalsByTicker: Map<string, Signal>
  signalsLoading: boolean
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
            vsSector={vsSectorByTicker[stock.ticker] ?? null}
            sectorBenchmark={sectorBenchmarkForStock(stock, sectorBenchmarks)}
            regularChange1dPct={regularChange1dByTicker[stock.ticker] ?? null}
            sectorBenchmarksRefreshing={sectorBenchmarksRefreshing}
            signal={signalsByTicker.get(stock.ticker.toUpperCase()) ?? null}
            signalLoading={signalsLoading}
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
  vsSectorByTicker,
  sectorBenchmarks,
  regularChange1dByTicker,
  sectorBenchmarksRefreshing,
  signalsByTicker,
  signalsLoading,
  defaultOpen = true,
}: {
  sector: string
  stocks: WatchlistStock[]
  onRemove: (ticker: string) => void
  marketSession: MarketSession
  fundamentalsByTicker: Record<string, StockFundamentals>
  fundamentalsLoading: boolean
  vsSectorByTicker: Record<string, SectorRelativeStrength>
  sectorBenchmarks: Record<string, SectorBenchmark>
  regularChange1dByTicker: Record<string, number>
  sectorBenchmarksRefreshing: boolean
  signalsByTicker: Map<string, Signal>
  signalsLoading: boolean
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
          <span className="text-xs tabular-nums text-muted font-medium">
            {stocks.length}
          </span>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'w-3.5 h-3.5 text-muted transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90',
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
                vsSector={vsSectorByTicker[stock.ticker] ?? null}
                sectorBenchmark={sectorBenchmarkForStock(stock, sectorBenchmarks)}
                regularChange1dPct={regularChange1dByTicker[stock.ticker] ?? null}
                sectorBenchmarksRefreshing={sectorBenchmarksRefreshing}
                signal={signalsByTicker.get(stock.ticker.toUpperCase()) ?? null}
                signalLoading={signalsLoading}
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

async function fundamentalsBatchFetcher(url: string): Promise<FundamentalsBatchResponse> {
  const tickers =
    new URL(url, window.location.origin).searchParams.get('tickers')?.split(',').filter(Boolean) ?? []

  const chunks: string[] = []
  for (let i = 0; i < tickers.length; i += BATCH_CHUNK) {
    chunks.push(tickers.slice(i, i + BATCH_CHUNK).join(','))
  }

  const merged: FundamentalsBatchResponse = {
    fundamentals: {},
    vs_sector: {},
    sector_benchmarks: {},
    regular_change_1d_pct: {},
    sector_benchmarks_refreshing: false,
    sector_benchmarks_age_minutes: null,
    refreshing: false,
  }

  const results = await Promise.all(
    chunks.map(async (chunk) => {
      const params = new URLSearchParams({ tickers: chunk })
      const res = await fetch(`/api/fundamentals/batch?${params}`)
      if (!res.ok) return null
      return res.json() as Promise<FundamentalsBatchResponse>
    }),
  )

  for (const data of results) {
    if (!data) continue
    Object.assign(merged.fundamentals, data.fundamentals ?? {})
    Object.assign(merged.vs_sector, data.vs_sector ?? {})
    Object.assign(merged.regular_change_1d_pct, data.regular_change_1d_pct ?? {})
    Object.assign(merged.sector_benchmarks, data.sector_benchmarks ?? {})
    if (data.sector_benchmarks_refreshing) merged.sector_benchmarks_refreshing = true
    if (data.refreshing) merged.refreshing = true
    if (data.sector_benchmarks_age_minutes != null) {
      merged.sector_benchmarks_age_minutes = data.sector_benchmarks_age_minutes
    }
  }

  return merged
}

export default function WatchlistPage() {
  const marketOpen = useMarketOpen()
  const marketSession = useMarketSession()
  const searchParams = useSearchParams()
  const suggestionsRefreshToken = searchParams.get('refresh') === '1' ? 1 : 0

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
  } = useSWR<FundamentalsBatchResponse>(tickerKey, fundamentalsBatchFetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 60_000,
    refreshInterval: (latest) => (latest?.refreshing ? 10_000 : 0),
  })

  const signalsKey = stocks.length > 0 ? '/api/signals' : null
  const {
    data: signalsData,
    isLoading: signalsLoading,
    mutate: mutateSignals,
  } = useSWR<SignalsResponse>(signalsKey, signalsFetcher, {
    revalidateOnFocus: false,
    refreshInterval: marketOpen ? 60_000 : 0,
  })

  const signalsByTicker = useMemo(
    () => signalsByTickerFromResponse(signalsData),
    [signalsData],
  )

  const fundamentalsByTicker = fundamentalsBatch?.fundamentals ?? {}
  const vsSectorByTicker = fundamentalsBatch?.vs_sector ?? {}
  const sectorBenchmarks = fundamentalsBatch?.sector_benchmarks ?? {}
  const regularChange1dByTicker = fundamentalsBatch?.regular_change_1d_pct ?? {}
  const sectorBenchmarksRefreshing = fundamentalsBatch?.sector_benchmarks_refreshing ?? false

  const cardBatchProps = {
    vsSectorByTicker,
    sectorBenchmarks,
    regularChange1dByTicker,
    sectorBenchmarksRefreshing,
    signalsByTicker,
    signalsLoading,
  }
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [sortMode, setSortMode] = useState<WatchlistSort>('sector')

  const refreshPrices = useCallback(() => {
    void mutate()
    void mutateFundamentals()
    void mutateSignals()
  }, [mutate, mutateFundamentals, mutateSignals])

  const refreshing = isValidating && !isLoading
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
    if (sortMode === 'bullish' || sortMode === 'bearish') {
      return {
        type: 'flat' as const,
        stocks: sortBySignalBias(stocks, signalsByTicker, sortMode),
        emptyFilter: sortMode,
      }
    }
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
    if (sortMode === 'vs_sector') {
      return {
        type: 'flat' as const,
        stocks: sortByVsSector(stocks, vsSectorByTicker),
      }
    }
    return { type: 'flat' as const, stocks: sortAlphabetical(stocks) }
  }, [stocks, sortMode, fundamentalsByTicker, vsSectorByTicker, signalsByTicker])

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
      void mutateSignals()
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
      async () => {
        const listRes = await fetch('/api/watchlist', { cache: 'no-store' })
        if (!listRes.ok) throw new Error('Failed to refresh watchlist')
        return (await listRes.json()) as WatchlistStock[]
      },
      { revalidate: false },
    )
    void mutateFundamentals()
    void mutateSignals()
  }

  const ownedTickers = useMemo(
    () => new Set(stocks.map((s) => s.ticker.toUpperCase())),
    [stocks],
  )

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:px-3 focus:py-1.5 focus:bg-zinc-800 focus:text-white focus:rounded-lg focus:text-sm"
      >
        Skip to main content
      </a>

      <div className="min-h-screen bg-zinc-950">
        <AppNav />

        {/* Main — bottom padding clears fixed bottom tab bar + safe area */}
        <main id="main" className="page-shell !pt-3">
          <h1 className="sr-only">Watchlist</h1>
          {!isLoading && stocks.length > 0 && (
            <div className="flex items-center justify-end gap-3 mb-3">
              <p className="type-meta text-zinc-500 tabular-nums shrink-0" aria-live="polite">
                {stocks.length} stocks
              </p>
            </div>
          )}

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
            marketOpen={marketOpen}
            refreshToken={suggestionsRefreshToken}
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
              {marketSession === 'regular' && (
                <div className="flex items-center justify-between gap-2 mb-2 px-0.5">
                  <p className="type-caption text-zinc-500">Live prices</p>
                  <RefreshCountdown seconds={countdown} refreshing={refreshing} />
                </div>
              )}

              <div className="mb-1">
                <WatchlistSortBar value={sortMode} onChange={setSortMode} />
              </div>

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
                    {...cardBatchProps}
                    defaultOpen
                  />
                ))
              ) : layout.stocks.length === 0 && (sortMode === 'bullish' || sortMode === 'bearish') ? (
                <p className="text-sm text-muted text-center py-12">
                  No {sortMode} signals in your watchlist right now.
                </p>
              ) : (
                <StockList
                  stocks={layout.stocks}
                  onRemove={handleRemove}
                  marketSession={marketSession}
                  fundamentalsByTicker={fundamentalsByTicker}
                  fundamentalsLoading={fundamentalsLoading}
                  {...cardBatchProps}
                />
              )}
            </div>
          )}
        </main>
      </div>
    </>
  )
}
