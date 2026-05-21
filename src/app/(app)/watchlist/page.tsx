'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { TrendingUp, ChevronDown } from 'lucide-react'
import WatchlistCard, { type WatchlistStock } from '@/components/watchlist/WatchlistCard'
import StockSearchInput, { type StockResult } from '@/components/watchlist/StockSearchInput'
import WatchlistSuggestions from '@/components/watchlist/WatchlistSuggestions'
import AppNav from '@/components/AppNav'
import LiveRefreshHeader, { LIVE_REFRESH_SEC } from '@/components/LiveRefreshHeader'
import { cn } from '@/lib/utils'

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

function sortByDailyChange(stocks: WatchlistStock[]): WatchlistStock[] {
  return [...stocks].sort((a, b) => {
    const ac = a.snapshot?.change_1d_pct ?? -Infinity
    const bc = b.snapshot?.change_1d_pct ?? -Infinity
    return bc - ac // highest gainer first
  })
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
  defaultOpen = true,
}: {
  sector: string
  stocks: WatchlistStock[]
  onRemove: (ticker: string) => void
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
              <WatchlistCard stock={stock} onRemove={onRemove} />
            </li>
          ))}
        </ul>
      )}

      {!open && <div className="mb-3" />}
    </section>
  )
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())
const REFRESH_SEC = LIVE_REFRESH_SEC

export default function WatchlistPage() {
  const { data: stocks = [], isLoading, isValidating, mutate } = useSWR<WatchlistStock[]>(
    '/api/watchlist',
    fetcher,
    { revalidateOnFocus: false },
  )
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [countdown, setCountdown] = useState(REFRESH_SEC)
  const [suggestionsRefresh, setSuggestionsRefresh] = useState(0)

  const refreshing = isValidating && !isLoading

  useEffect(() => {
    if (!stocks.length) return
    let secs = REFRESH_SEC
    setCountdown(secs)
    const tick = setInterval(() => {
      secs -= 1
      if (secs <= 0) {
        mutate()
        secs = REFRESH_SEC
      }
      setCountdown(secs)
    }, 1000)
    return () => clearInterval(tick)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocks.length > 0])

  useEffect(() => {
    if (!refreshing) setCountdown(REFRESH_SEC)
  }, [refreshing])

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
    mutate(stocks.filter((s) => s.ticker !== ticker), { revalidate: false })
    await fetch(`/api/watchlist/${ticker}`, { method: 'DELETE' })
    mutate()
  }

  const grouped = groupBySector(stocks)
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
            mutate()
            setCountdown(REFRESH_SEC)
            setSuggestionsRefresh((n) => n + 1)
          }}
          refreshing={refreshing}
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
          />

          {/* Content */}
          {isLoading ? (
            <div className="space-y-5" aria-busy="true" aria-label="Loading watchlist">
              {[1, 2, 3].map((n) => (
                <div key={n} className="h-[220px] rounded-2xl bg-zinc-900 animate-pulse" style={{ animationDelay: `${n * 80}ms` }} />
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
              />
              {grouped.map(([sector, sectorStocks]) => (
                <SectorGroup
                  key={sector}
                  sector={sector}
                  stocks={sectorStocks}
                  onRemove={handleRemove}
                  defaultOpen
                />
              ))}
            </div>
          )}
        </main>
      </div>
    </>
  )
}
