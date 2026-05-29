'use client'

import { useCallback, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Flame, Plus, SkipForward } from 'lucide-react'
import CollapseChevron from '@/components/CollapseChevron'
import NarrativeSummaryBlocks from '@/components/NarrativeSummaryBlocks'
import StockLogo from '@/components/StockLogo'
import WatchlistCardSkeleton from '@/components/watchlist/WatchlistCardSkeleton'
import { PRICE_REFRESH_MS } from '@/lib/market-hours'
import { cn } from '@/lib/utils'
import type { PickNarrativesResponse, WatchlistSuggestion, WatchlistSuggestionsResponse } from '@/types'
import type { StockResult } from '@/components/watchlist/StockSearchInput'

const fetcher = async (url: string): Promise<WatchlistSuggestionsResponse> => {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load suggestions')
  return res.json()
}

const narrativesFetcher = async (url: string): Promise<PickNarrativesResponse> => {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load narratives')
  return res.json()
}

function mergeSuggestionNarratives(
  suggestions: WatchlistSuggestion[],
  narratives: PickNarrativesResponse['narratives'],
): WatchlistSuggestion[] {
  if (!Object.keys(narratives).length) return suggestions
  return suggestions.map((s) => {
    const narrative = narratives[s.ticker.toUpperCase()]
    if (!narrative) return s
    return {
      ...s,
      company_blurb: narrative.company_blurb ?? s.company_blurb,
      thesis: narrative.thesis,
      main_risk: narrative.main_risk,
      narrative_source: narrative.narrative_source,
    }
  })
}

function fmt(n: number, d = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

interface Props {
  ownedTickers: Set<string>
  onAdd: (result: StockResult) => void
  adding?: boolean
  refreshToken?: number
  marketOpen?: boolean
}

export default function WatchlistSuggestions({
  ownedTickers,
  onAdd,
  adding,
  refreshToken = 0,
  marketOpen = true,
}: Props) {
  const url = useMemo(
    () =>
      refreshToken > 0
        ? `/api/watchlist/suggestions?refresh=1&r=${refreshToken}`
        : '/api/watchlist/suggestions',
    [refreshToken],
  )

  const { data, isLoading, error, mutate } = useSWR<WatchlistSuggestionsResponse>(url, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 0,
    refreshInterval: marketOpen ? PRICE_REFRESH_MS : 0,
  })

  const [open, setOpen] = useState(false)
  const [skippingTicker, setSkippingTicker] = useState<string | null>(null)

  const skipTicker = useCallback(
    async (ticker: string) => {
      const sym = ticker.toUpperCase()
      setSkippingTicker(sym)
      try {
        const res = await fetch('/api/watchlist/suggestions/skip', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker: sym }),
        })
        if (!res.ok) return
        const next = (await res.json()) as WatchlistSuggestionsResponse
        await mutate(next, { revalidate: false })
      } finally {
        setSkippingTicker(null)
      }
    },
    [mutate],
  )

  const visible = (data?.suggestions ?? []).filter(
    (s) => !ownedTickers.has(s.ticker.toUpperCase()),
  )

  const pendingNarrativeTickers = useMemo(() => {
    if (!data?.llm_enabled) return ''
    const pending = visible
      .filter((s) => s.narrative_source === 'mechanical')
      .map((s) => s.ticker.toUpperCase())
    return [...new Set(pending)].join(',')
  }, [data?.llm_enabled, visible])

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

  const displaySuggestions = useMemo(
    () => mergeSuggestionNarratives(visible, narrativeData?.narratives ?? {}),
    [visible, narrativeData],
  )

  const showEmpty = !isLoading && !error && displaySuggestions.length === 0

  const subtitle = isLoading
    ? 'Scanning market movers…'
    : showEmpty
      ? 'Nothing new to show right now'
      : visible.length
        ? open
          ? 'Not on your watchlist · momentum + buy ratings'
          : `Not on your watchlist · ${displaySuggestions.length} name${displaySuggestions.length === 1 ? '' : 's'}`
        : 'Not on your watchlist'

  return (
    <section
      className={cn(open ? 'mb-4' : 'mb-2')}
      aria-label="Trending stocks not on your watchlist"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="watchlist-suggestions-panel"
        className="w-full flex items-center gap-2 min-h-[44px] px-0.5 -mx-0.5 rounded-xl active:bg-zinc-900/60 transition-colors [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500"
      >
        <Flame className="w-4 h-4 text-orange-400 shrink-0" aria-hidden="true" />
        <div className="flex-1 min-w-0 text-left">
          <h2 className="text-base font-bold text-white">Trending</h2>
          <p className="text-sm text-zinc-500 mt-0.5 truncate">{subtitle}</p>
        </div>
        {data?.llm_enabled && !isLoading && visible.length > 0 && (
          <span className="type-micro font-bold text-blue-400/80 uppercase tracking-wide shrink-0">AI</span>
        )}
        {!isLoading && displaySuggestions.length > 0 && (
          <span className="type-meta font-bold text-orange-400/90 tabular-nums shrink-0">
            {displaySuggestions.length}
          </span>
        )}
        <CollapseChevron open={open} />
      </button>

      {open && (
        <div id="watchlist-suggestions-panel" className="mt-2">
      {showEmpty ? (
        <div className="rounded-2xl bg-zinc-900/80 border border-zinc-800 px-4 py-4">
          <p className="text-sm text-zinc-400 leading-relaxed">
            No market movers matched our bar, you already watch them, or you skipped the current list.
            Skipped names return after 24 hours.
          </p>
        </div>
      ) : isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading trending suggestions">
          {[1, 2, 3].map((n) => (
            <WatchlistCardSkeleton key={n} rank={n} />
          ))}
        </div>
      ) : (
        <ul className="space-y-2">
          {displaySuggestions.map((s, i) => {
            const isUp = s.change_1d_pct >= 0
            return (
            <li
              key={s.ticker}
              className="rounded-[20px] bg-gradient-to-br from-orange-500/10 to-zinc-900 border border-orange-500/15 px-5 py-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="type-meta font-bold text-orange-400/90">#{i + 1}</span>
                    <StockLogo ticker={s.ticker} size="sm" />
                    <span className="text-lg font-bold text-white">{s.ticker}</span>
                    {s.sector && s.sector !== 'Other' && (
                      <span className="type-micro font-semibold text-orange-300/90 px-1.5 py-0.5 rounded-md bg-orange-500/10">
                        {s.sector}
                      </span>
                    )}
                    <span className="text-xs text-zinc-500 truncate w-full sm:w-auto">{s.company_name}</span>
                  </div>
                  <p className="text-sm text-orange-200/80 mt-1">{s.headline}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-bold text-white tabular-nums">${fmt(s.current_price)}</p>
                  <p
                    className={cn(
                      'text-xs font-bold tabular-nums',
                      isUp ? 'text-emerald-400' : 'text-red-400',
                    )}
                  >
                    {isUp ? '+' : ''}{s.change_1d_pct.toFixed(2)}% today
                  </p>
                </div>
              </div>

              <NarrativeSummaryBlocks
                variant="combined"
                company_blurb={s.company_blurb}
                thesis={s.thesis}
                main_risk={s.main_risk}
                narrative_source={s.narrative_source}
                llm_enabled={data?.llm_enabled}
              />

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={adding || skippingTicker === s.ticker.toUpperCase()}
                  onClick={() =>
                    onAdd({
                      ticker: s.ticker,
                      company_name: s.company_name,
                      sector: s.sector,
                      price: null,
                      change_pct: s.change_1d_pct ?? null,
                    })
                  }
                  className={cn(
                    'flex-1 min-h-[48px] rounded-xl text-base font-semibold flex items-center justify-center gap-2',
                    'bg-orange-500/20 text-orange-200 active:bg-orange-500/30 transition-colors',
                    '[touch-action:manipulation] disabled:opacity-50',
                  )}
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                  Add to watchlist
                </button>
                <button
                  type="button"
                  disabled={adding || skippingTicker === s.ticker.toUpperCase()}
                  onClick={() => void skipTicker(s.ticker)}
                  aria-label={`Skip ${s.ticker} for 24 hours`}
                  className={cn(
                    'min-h-[48px] px-4 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5',
                    'bg-zinc-800/80 text-zinc-400 active:bg-zinc-700 transition-colors',
                    '[touch-action:manipulation] disabled:opacity-50',
                  )}
                >
                  <SkipForward className="w-4 h-4 shrink-0" aria-hidden="true" />
                  Skip
                </button>
              </div>
            </li>
            )
          })}
        </ul>
      )}

      {data?.generated_at && !isLoading && displaySuggestions.length > 0 && (
        <p className="text-xs text-muted mt-3 leading-relaxed">
          Trending list rescans every 3h · skipped names hidden 24h
          {marketOpen ? ' · live prices refresh during market hours' : ''}
          {data.llm_enabled ? ' · AI context lines' : ''}
        </p>
      )}
        </div>
      )}
    </section>
  )
}
