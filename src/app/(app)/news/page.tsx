'use client'

import useSWR from 'swr'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import AppNav from '@/components/AppNav'
import CollapseChevron from '@/components/CollapseChevron'
import StockLogo from '@/components/StockLogo'
import { useMarketOpen } from '@/hooks/useMarketOpen'
import {
  TrendingUp,
  TrendingDown,
  Volume2,
  VolumeX,
  Zap,
  Newspaper,
} from 'lucide-react'
import NewsRow from '@/components/NewsRow'
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

function truncatePreview(text: string, max = 72): string {
  const t = text.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max - 1).trim()}…`
}

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${n.toFixed(2)}`
}

function headlinesBorderClass(bias: Signal['bias']): string {
  if (bias === 'bullish') return 'border-emerald-500/10'
  if (bias === 'bearish') return 'border-red-500/10'
  return 'border-white/[0.04]'
}

function signalCardShellClass(bias: Signal['bias']): string {
  return cn(
    'signal-card-b overflow-hidden',
    bias === 'bullish' && 'signal-card-b--bullish',
    bias === 'bearish' && 'signal-card-b--bearish',
    bias === 'quiet' && 'signal-card-b--quiet',
  )
}

function SignalHeroHeader({ signal }: { signal: Signal }) {
  const isUp = (signal.change_1d_pct ?? 0) >= 0

  return (
    <div className="flex items-start justify-between gap-2">
      <div className="flex items-start gap-3 min-w-0 flex-1">
        <StockLogo ticker={signal.ticker} size="md" />
        <div className="min-w-0 pt-0.5">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-lg font-bold text-white tracking-tight" translate="no">
              {signal.ticker}
            </span>
          </div>
          <p className="text-sm text-zinc-400 truncate leading-snug">{signal.company_name}</p>
          {signal.sector && (
            <p className="type-meta text-zinc-500 mt-1">
              {signal.sector} · watchlist
            </p>
          )}
        </div>
      </div>
      {signal.price != null && (
        <div className="text-right shrink-0">
          <p className="text-base font-bold text-white tabular-nums leading-tight">
            {fmtPrice(signal.price)}
          </p>
          {signal.change_1d_pct != null && (
            <p className={cn(
              'text-xs font-semibold tabular-nums mt-0.5',
              isUp ? 'text-emerald-400' : 'text-red-400',
            )}>
              {fmtPct(signal.change_1d_pct)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ReasonChip({ reason }: { reason: SignalReason }) {
  const styles =
    reason.tone === 'bullish' ? 'bg-emerald-500/10 text-emerald-300' :
    reason.tone === 'bearish' ? 'bg-red-500/10 text-red-300' :
    'bg-zinc-800 text-zinc-400'
  return (
    <span className={cn('text-sm sm:text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap', styles)}>
      {reason.label}
    </span>
  )
}

function SignalReasonChips({ signal }: { signal: Signal }) {
  if (!signal.reasons.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {signal.reasons.map((r, i) => (
        <ReasonChip key={i} reason={r} />
      ))}
    </div>
  )
}

function headlinesPreview(signal: Signal): string {
  const top = signal.news[0]
  if (top) return truncatePreview(top.title)
  return 'No headlines right now'
}

function SignalHeadlinesRow({ signal, cardId }: { signal: Signal; cardId: string }) {
  const [open, setOpen] = useState(false)
  const hasNews = signal.news.length > 0
  const preview = headlinesPreview(signal)

  return (
    <div className={cn('border-t bg-zinc-950/35', headlinesBorderClass(signal.bias))}>
      <button
        type="button"
        id={`${cardId}-headlines-trigger`}
        aria-expanded={open}
        aria-controls={`${cardId}-headlines-panel`}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'w-full text-left px-4 py-3 min-h-[48px]',
          'active:bg-zinc-800/50 transition-colors [touch-action:manipulation]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500/40',
        )}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Newspaper className="w-3.5 h-3.5 text-zinc-500 shrink-0" aria-hidden="true" />
              <span className="type-meta font-semibold text-zinc-300">Headlines</span>
            </div>
            {!open && (
              <p className="type-meta text-muted-preview mt-1 leading-snug truncate">{preview}</p>
            )}
          </div>
          <CollapseChevron open={open} className="text-muted shrink-0 mt-0.5" />
        </div>
      </button>
      {open && (
        <div
          id={`${cardId}-headlines-panel`}
          role="region"
          aria-labelledby={`${cardId}-headlines-trigger`}
          className="px-4 pb-3.5 pt-0 space-y-2"
        >
          {hasNews ? (
            signal.news.map((n, i) => (
              <NewsRow key={i} item={n} />
            ))
          ) : (
            <p className="text-xs text-muted px-1 py-2">No headlines for this stock right now.</p>
          )}
        </div>
      )}
    </div>
  )
}

function SignalCardHero({ signal }: { signal: Signal }) {
  return (
    <div className="signal-card-b-hero relative px-4 pt-5 pb-3">
      <SignalHeroHeader signal={signal} />
      <SignalReasonChips signal={signal} />
    </div>
  )
}

function SignalCard({ signal }: { signal: Signal }) {
  const cardId = `signal-${signal.ticker}-${signal.bias}`

  return (
    <div className={signalCardShellClass(signal.bias)}>
      <SignalCardHero signal={signal} />
      <SignalHeadlinesRow signal={signal} cardId={cardId} />
    </div>
  )
}

function SignalList({
  signals,
  emptyMsg,
}: {
  signals: Signal[]
  emptyMsg?: string
}) {
  if (!signals.length) {
    return emptyMsg ? <p className="text-xs text-muted px-1 py-1">{emptyMsg}</p> : null
  }

  return (
    <ul className="space-y-3">
      {signals.map((s) => (
        <li key={s.ticker}>
          <SignalCard signal={s} />
        </li>
      ))}
    </ul>
  )
}

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
  icon: ReactNode
  count: number
  titleClass: string
  countClass: string
  defaultOpen: boolean
  hideWhenEmpty?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (hideWhenEmpty && count === 0) return null

  return (
    <section className="mb-5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          'w-full min-h-[48px] flex items-center justify-between rounded-2xl px-4 py-3',
          'border border-white/[0.06] bg-zinc-900/40',
          'active:bg-zinc-800/50 transition-colors [touch-action:manipulation]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span aria-hidden="true" className="shrink-0">{icon}</span>
          <span className={cn('text-base sm:text-sm font-bold', titleClass)}>{title}</span>
          <span className={cn('type-caption font-semibold tabular-nums', countClass)}>({count})</span>
        </div>
        <CollapseChevron open={open} className={countClass} />
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
  icon: ReactNode
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
      <SignalList signals={signals} emptyMsg={emptyMsg} />
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
      <SignalList signals={quiet} />
    </CollapsibleSection>
  )
}

export default function NewsPage() {
  const marketOpen = useMarketOpen()
  const { data, isLoading, isValidating, mutate } = useSWR<SignalsResponse>('/api/signals', fetcher, {
    revalidateOnFocus: false,
  })
  const refreshing = isValidating && !isLoading

  const handleRefresh = useCallback(() => {
    void mutate()
  }, [mutate])

  useEffect(() => {
    if (!marketOpen) return
    const id = setInterval(() => {
      void mutate()
    }, 60_000)
    return () => clearInterval(id)
  }, [marketOpen, mutate])

  const hasAnySignal = (data?.bullish.length ?? 0) + (data?.bearish.length ?? 0) > 0

  return (
    <div className="min-h-screen bg-zinc-950">
      <AppNav onRefresh={handleRefresh} refreshing={refreshing} marketOpen={marketOpen} showRefresh />

      <main id="main" className="page-shell !pt-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0">
            <h1 className="text-2xl sm:text-xl font-bold text-white tracking-tight">Signals</h1>
            <Zap className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />
          </div>
          {data?.generated_at && !isLoading && (
            <p className="type-meta text-zinc-500 tabular-nums shrink-0">
              Updated {timeAgo(data.generated_at)}
            </p>
          )}
        </div>
        <p className="type-caption text-zinc-500 mb-4 -mt-1">From your watchlist</p>

        {isLoading ? (
          <div className="space-y-3" aria-busy="true">
            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="signal-card-b h-[160px] animate-pulse opacity-60"
                style={{ animationDelay: `${n * 80}ms` }}
              />
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
          <>
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
          </>
        )}
      </main>
    </div>
  )
}
