'use client'

import useSWR from 'swr'
import { useState } from 'react'
import AppNav from '@/components/AppNav'
import StockLogo from '@/components/StockLogo'
import {
  TrendingUp,
  TrendingDown,
  Volume2,
  VolumeX,
  ExternalLink,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Signal, SignalReason, SignalsResponse, SignalNewsItem } from '@/types'

const fetcher = (u: string) => fetch(u).then((r) => r.json())

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ── Reason chip ───────────────────────────────────────────────────────────────
function ReasonChip({ reason }: { reason: SignalReason }) {
  const styles =
    reason.tone === 'bullish' ? 'bg-emerald-500/10 text-emerald-300' :
    reason.tone === 'bearish' ? 'bg-red-500/10 text-red-300' :
    'bg-zinc-800 text-zinc-400'
  return (
    <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap', styles)}>
      {reason.label}
    </span>
  )
}

// ── Signal card (collapsible) ─────────────────────────────────────────────────
function SignalCard({ signal }: { signal: Signal }) {
  const [open, setOpen] = useState(false)
  const isUp = (signal.change_1d_pct ?? 0) >= 0
  const hasNews = signal.news.length > 0
  const topNews = signal.news[0]

  return (
    <div className="card-surface overflow-hidden">
      {/* Tappable header */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full text-left px-5 py-4 active:bg-zinc-800/60 transition-colors [touch-action:manipulation]"
      >
        {/* Top row: ticker + name | price + change */}
        <div className="flex items-start justify-between gap-3 mb-2.5">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <StockLogo ticker={signal.ticker} size="md" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 flex-wrap">
              <span className="text-base font-bold text-white tracking-tight" translate="no">
                {signal.ticker}
              </span>
              <span className="text-xs text-zinc-500 truncate">{signal.company_name}</span>
            </div>
            {signal.sector && (
              <p className="text-[11px] text-zinc-600 mt-0.5">
                {signal.sector} · watchlist
              </p>
            )}
          </div>
          </div>
          {signal.price != null && (
            <div className="text-right shrink-0">
              <p className="text-base font-bold text-white tabular-nums leading-tight">
                ${signal.price.toFixed(2)}
              </p>
              {signal.change_1d_pct != null && (
                <p className={cn(
                  'text-xs font-semibold tabular-nums mt-0.5',
                  isUp ? 'text-emerald-400' : 'text-red-400'
                )}>
                  {isUp ? '+' : ''}{signal.change_1d_pct.toFixed(2)}%
                </p>
              )}
            </div>
          )}
        </div>

        {/* Reason chips */}
        {signal.reasons.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-1">
            {signal.reasons.map((r, i) => (
              <ReasonChip key={i} reason={r} />
            ))}
          </div>
        )}

        {/* Top news preview (collapsed) + expand affordance */}
        <div className="flex items-center justify-between gap-2 mt-2">
          {topNews && !open ? (
            <p className="text-xs text-zinc-400 truncate flex-1 min-w-0">
              <span className="text-zinc-600 mr-1.5">●</span>
              {topNews.title}
            </p>
          ) : (
            <span className="text-[11px] text-zinc-600">
              {hasNews ? `${signal.news.length} ${signal.news.length === 1 ? 'headline' : 'headlines'}` : 'No news'}
            </span>
          )}
          <ChevronDown
            className={cn('w-4 h-4 text-zinc-600 shrink-0 transition-transform duration-200', open ? 'rotate-180' : '')}
            aria-hidden="true"
          />
        </div>
      </button>

      {/* Expanded news list */}
      {open && hasNews && (
        <div className="px-4 pb-3 pt-1 border-t border-white/[0.04] space-y-2">
          {signal.news.map((n, i) => (
            <NewsRow key={i} item={n} />
          ))}
        </div>
      )}
    </div>
  )
}

function NewsRow({ item }: { item: SignalNewsItem }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-xl px-3 py-2.5 -mx-1 active:bg-zinc-800/60 transition-colors [touch-action:manipulation]"
    >
      <div className="flex items-start gap-2.5">
        <div
          className={cn(
            'w-1 self-stretch rounded-full mt-0.5 shrink-0',
            item.sentiment === 'bullish' ? 'bg-emerald-500/60' : 'bg-red-500/60'
          )}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-200 leading-snug">{item.title}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px] text-zinc-500">{item.source}</span>
            <span className="text-[11px] text-zinc-600">·</span>
            <span className="text-[11px] text-zinc-600">{timeAgo(item.published_at)}</span>
          </div>
        </div>
        <ExternalLink className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-0.5" aria-hidden="true" />
      </div>
    </a>
  )
}

// ── Collapsible section header (Bullish / Bearish / Quiet) ────────────────────
function CollapsibleSection({
  title,
  icon,
  count,
  titleClass,
  countClass,
  defaultOpen,
  hideWhenEmpty,
  children,
}: {
  title: string
  icon: React.ReactNode
  count: number
  titleClass: string
  countClass: string
  defaultOpen: boolean
  hideWhenEmpty?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (hideWhenEmpty && count === 0) return null

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full min-h-[48px] flex items-center justify-between card-surface px-5 py-4 active:bg-zinc-800/60 transition-colors [touch-action:manipulation]"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span aria-hidden="true" className="shrink-0">{icon}</span>
          <span className={cn('text-base font-semibold', titleClass)}>{title}</span>
          <span className={cn('text-xs tabular-nums', countClass)}>{count}</span>
        </div>
        <ChevronDown
          className={cn('w-4 h-4 shrink-0 transition-transform duration-200', countClass, open ? 'rotate-180' : '')}
          aria-hidden="true"
        />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </section>
  )
}

function BullishBearishSection({
  title,
  icon,
  signals,
  emptyMsg,
  titleClass,
  countClass,
  defaultOpen,
}: {
  title: string
  icon: React.ReactNode
  signals: Signal[]
  emptyMsg: string
  titleClass: string
  countClass: string
  defaultOpen: boolean
}) {
  return (
    <CollapsibleSection
      title={title}
      icon={icon}
      count={signals.length}
      titleClass={titleClass}
      countClass={countClass}
      defaultOpen={defaultOpen}
    >
      {signals.length === 0 ? (
        <p className="text-xs text-zinc-600 px-1 py-1">{emptyMsg}</p>
      ) : (
        <ul className="space-y-2.5">
          {signals.map((s) => (
            <li key={s.ticker}>
              <SignalCard signal={s} />
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  )
}

function QuietSection({ quiet }: { quiet: Signal[] }) {
  return (
    <CollapsibleSection
      title="Quiet"
      icon={<VolumeX className="w-4 h-4 text-zinc-500" aria-hidden="true" />}
      count={quiet.length}
      titleClass="text-zinc-300"
      countClass="text-zinc-500"
      defaultOpen={false}
      hideWhenEmpty
    >
      <ul className="space-y-1.5">
        {quiet.map((s) => (
          <li key={s.ticker} className="flex items-center justify-between bg-zinc-900/60 rounded-xl px-4 py-2.5 gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <StockLogo ticker={s.ticker} size="sm" />
              <span className="text-sm font-semibold text-zinc-300 tracking-tight" translate="no">{s.ticker}</span>
              <span className="text-xs text-zinc-600 truncate">{s.company_name}</span>
            </div>
            {s.change_1d_pct != null && (
              <span className={cn(
                'text-xs font-medium tabular-nums shrink-0',
                s.change_1d_pct >= 0 ? 'text-emerald-500/80' : 'text-red-500/80'
              )}>
                {s.change_1d_pct >= 0 ? '+' : ''}{s.change_1d_pct.toFixed(2)}%
              </span>
            )}
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function NewsPage() {
  const { data, isLoading, isValidating, mutate } = useSWR<SignalsResponse>('/api/signals', fetcher, {
    revalidateOnFocus: false,
  })
  const refreshing = isValidating && !isLoading

  const hasAnySignal = (data?.bullish.length ?? 0) + (data?.bearish.length ?? 0) > 0

  return (
    <div className="min-h-screen bg-zinc-950">
      <AppNav onRefresh={() => mutate()} refreshing={refreshing} showRefresh />

      <main id="main" className="page-shell">
          <div className="mb-7">
            <h1 className="page-title">Signals</h1>
            <p className="page-subtitle">From your watchlist</p>
            {data?.generated_at && (
              <div className="flex items-center gap-1.5 mt-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <p className="text-xs text-zinc-400 font-medium">
                  Updated <span className="text-zinc-300">{timeAgo(data.generated_at)}</span>
                </p>
              </div>
            )}
          </div>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-[120px] rounded-2xl bg-zinc-900 animate-pulse" style={{ animationDelay: `${n * 80}ms` }} />
            ))}
          </div>
        ) : !data ? (
          <p className="text-zinc-500 text-sm text-center py-16">Failed to load signals. Try refreshing.</p>
        ) : !hasAnySignal && !data.quiet.length ? (
          <div className="text-center py-28">
            <div className="w-16 h-16 rounded-3xl bg-zinc-900 flex items-center justify-center mx-auto mb-5">
              <Volume2 className="w-7 h-7 text-zinc-700" aria-hidden="true" />
            </div>
            <p className="text-white text-base font-semibold mb-1">Nothing in your watchlist yet</p>
            <p className="text-zinc-500 text-sm max-w-[220px] mx-auto">Add stocks to your watchlist to see daily signals here.</p>
          </div>
        ) : (
          <div className="space-y-7">
            <BullishBearishSection
              title="Bullish"
              icon={<TrendingUp className="w-4 h-4 text-emerald-400" aria-hidden="true" />}
              signals={data.bullish}
              emptyMsg="No strong bullish signals today."
              titleClass="text-emerald-300"
              countClass="text-emerald-500/80"
              defaultOpen
            />
            <BullishBearishSection
              title="Bearish"
              icon={<TrendingDown className="w-4 h-4 text-red-400" aria-hidden="true" />}
              signals={data.bearish}
              emptyMsg="No strong bearish signals today."
              titleClass="text-red-300"
              countClass="text-red-500/80"
              defaultOpen
            />
            <QuietSection quiet={data.quiet} />
          </div>
        )}
      </main>
    </div>
  )
}
