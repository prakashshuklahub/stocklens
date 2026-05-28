'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Briefcase, Loader2 } from 'lucide-react'
import CollapseChevron from '@/components/CollapseChevron'
import StockLogo from '@/components/StockLogo'
import { PORTFOLIO_SUMMARY_TAG_LABELS } from '@/lib/portfolio-summary-tags'
import { getUSMarketSession } from '@/lib/market-hours'
import { cn } from '@/lib/utils'
import type { PortfolioSummaryResponse, PortfolioSummarySentiment } from '@/types'

const STORAGE_KEY = 'portfolio-summary-open'

const fetcher = async (url: string): Promise<PortfolioSummaryResponse> => {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to load portfolio summary')
  return res.json()
}

function sentimentBadgeClass(s: PortfolioSummarySentiment): string {
  if (s === 'positive') return 'bg-emerald-500/15 text-emerald-300'
  if (s === 'negative') return 'bg-red-500/15 text-red-300'
  return 'bg-zinc-800 text-zinc-400'
}

function sentimentLabel(s: PortfolioSummarySentiment): string {
  if (s === 'positive') return 'Positive'
  if (s === 'negative') return 'Negative'
  return 'Neutral'
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function updatedLabel(generatedAt: string, marketSession: 'regular' | 'closed'): string {
  const age = timeAgo(generatedAt)
  if (marketSession === 'closed') return `close · ${age}`
  return age
}

type Props = {
  holdingCount: number
}

export default function PortfolioDailySummary({ holdingCount }: Props) {
  const { data, isLoading, mutate } = useSWR<PortfolioSummaryResponse>(
    holdingCount > 0 ? '/api/portfolio/summary' : null,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: (latest) => (latest?.stale ? 5000 : 0) },
  )

  const [open, setOpen] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved != null) setOpen(saved === '1')
  }, [])

  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem(STORAGE_KEY, open ? '1' : '0')
  }, [open, hydrated])

  const summary = data?.summary
  const refreshing = Boolean(data?.refreshing || data?.stale)

  const metaLine = useMemo(() => {
    if (isLoading && !summary) return 'Preparing…'
    if (!summary) return 'Tap to load'
    return `${summary.holdings.length} stocks · ${updatedLabel(summary.generated_at, summary.market_session)}`
  }, [isLoading, summary])

  if (holdingCount === 0) return null

  return (
    <section className="mb-2" aria-label="Daily portfolio briefing">
      <div className="rounded-xl border border-white/[0.06] bg-zinc-900/50 overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="portfolio-daily-summary-panel"
          className="w-full flex items-center gap-2 min-h-[36px] px-3 py-1.5 active:bg-zinc-800/40 transition-colors [touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40"
        >
          <Briefcase className="w-3.5 h-3.5 text-blue-400 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-sm font-semibold text-white shrink-0">Daily briefing</span>
              <span className="text-xs text-zinc-500 truncate">· {metaLine}</span>
            </div>
          </div>
          {refreshing && (
            <Loader2 className="w-3.5 h-3.5 text-zinc-500 animate-spin shrink-0" aria-hidden="true" />
          )}
          <CollapseChevron open={open} className="shrink-0" />
        </button>

        {open && (
          <div id="portfolio-daily-summary-panel" className="border-t border-white/[0.06]">
            {isLoading && !summary ? (
              <div className="px-3 py-2 space-y-1.5" aria-busy="true">
                <div className="h-3 w-3/4 rounded bg-zinc-800/70 animate-pulse" />
                <div className="h-3 w-1/2 rounded bg-zinc-800/70 animate-pulse" />
              </div>
            ) : summary ? (
              <>
                <p className="px-3 pt-2 pb-1.5 text-xs text-zinc-300 leading-relaxed [text-wrap:pretty]">
                  {summary.portfolio_headline}
                </p>
                <ul className="divide-y divide-white/[0.04] max-h-[min(50vh,420px)] overflow-y-auto">
                  {summary.holdings.map((h) => (
                    <li key={h.ticker} className="px-3 py-2">
                      <div className="flex items-start gap-2">
                        <StockLogo ticker={h.ticker} size="sm" className="scale-90 origin-top-left" />
                        <div className="min-w-0 flex-1 -mt-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-sm font-bold text-white">{h.ticker}</span>
                            <span
                              className={cn(
                                'type-micro font-bold uppercase px-1.5 py-0.5 rounded-full',
                                sentimentBadgeClass(h.sentiment),
                              )}
                            >
                              {sentimentLabel(h.sentiment)}
                            </span>
                            {h.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag}
                                className="type-micro font-medium px-1.5 py-0.5 rounded-full bg-zinc-800 text-zinc-400"
                              >
                                {PORTFOLIO_SUMMARY_TAG_LABELS[tag]}
                              </span>
                            ))}
                          </div>
                          <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed [text-wrap:pretty]">
                            {h.summary}
                          </p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="px-3 py-1.5 border-t border-white/[0.04] type-micro text-muted">
                  {summary.narrative_source === 'llm' ? 'AI summary' : 'Signal summary'}
                  {getUSMarketSession() === 'regular' && data?.stale ? ' · updating…' : ''}
                  {data?.stale && (
                    <>
                      {' · '}
                      <button
                        type="button"
                        onClick={() =>
                          void mutate(fetcher('/api/portfolio/summary?refresh=1'), { revalidate: false })
                        }
                        className="text-blue-400/90 font-semibold [touch-action:manipulation]"
                      >
                        Refresh
                      </button>
                    </>
                  )}
                </p>
              </>
            ) : (
              <p className="px-3 py-2 text-xs text-zinc-500">No briefing yet.</p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
