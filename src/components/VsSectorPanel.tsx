'use client'

import type { MarketSession } from '@/lib/market-hours'
import {
  computeLiveD1Window,
  computeRsScoreWithD1,
  d1VsSectorFootnote,
  d1VsSectorLabel,
  regularSessionChange1d,
  relativeStrengthUserCopy,
  sectorEtfSubtitle,
  vsSectorBadgeLabel,
} from '@/lib/sector-relative-strength'
import { isBenchmarkableSector, normalizeWatchlistSector } from '@/lib/sector-relative-strength-scoring'
import { cn } from '@/lib/utils'
import type { SectorBenchmark, SectorRelativeStrength, VsSectorWindow } from '@/types'

function fmtPct(n: number | null | undefined, showPlus = true): string | null {
  if (n == null) return null
  return `${showPlus && n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

function VsSectorDelta({ delta }: { delta: number | null }) {
  if (delta == null) {
    return <span className="text-zinc-600 tabular-nums">—</span>
  }
  const isPos = delta >= 0
  return (
    <span
      className={cn(
        'text-sm font-bold tabular-nums',
        isPos ? 'text-emerald-400' : 'text-red-400',
      )}
    >
      {fmtPct(delta)}
    </span>
  )
}

function VsSectorWindowRow({
  label,
  window,
}: {
  label: string
  window: VsSectorWindow | null
}) {
  if (!window) return null
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-zinc-500">{label}</span>
      <div className="flex items-center gap-2 tabular-nums">
        <span className="text-zinc-400">{fmtPct(window.stock, false)}</span>
        <span className="text-zinc-600">vs</span>
        <span className="text-zinc-400">{fmtPct(window.sector, false)}</span>
        <span className="text-zinc-600">·</span>
        <VsSectorDelta delta={window.delta} />
      </div>
    </div>
  )
}

export function vsSectorCollapsedPreview(
  vsSector: SectorRelativeStrength | null | undefined,
  stockSector: string | null | undefined,
): string | null {
  const sectorLabel = vsSector?.sector ?? normalizeWatchlistSector(stockSector)
  if (sectorLabel === 'Other' || !isBenchmarkableSector(sectorLabel)) return null
  if (!vsSector?.windows) return 'Sector comparison'

  const badge = vsSectorBadgeLabel(vsSector.badge)
  const delta = vsSector.windows.d7?.delta ?? vsSector.windows.d30?.delta ?? null
  if (badge && delta != null) {
    const dir = delta >= 0 ? 'ahead by' : 'behind by'
    return `${badge} · ${dir} ${fmtPct(Math.abs(delta), false)}`
  }
  if (badge) return badge
  const rsCopy = vsSector.rs_score != null ? relativeStrengthUserCopy(vsSector.rs_score) : null
  return rsCopy?.tier ?? 'Sector comparison'
}

export default function VsSectorPanel({
  vsSector,
  sectorBenchmark,
  stockSector,
  regularChange1dPct,
  stockChange1d,
  snapshotSession,
  marketSession,
  refreshing,
}: {
  vsSector: SectorRelativeStrength | null | undefined
  sectorBenchmark: SectorBenchmark | null | undefined
  stockSector: string | null | undefined
  regularChange1dPct: number | null | undefined
  stockChange1d: number | null | undefined
  snapshotSession: MarketSession | undefined
  marketSession: MarketSession
  refreshing?: boolean
}) {
  const sectorLabel = vsSector?.sector ?? normalizeWatchlistSector(stockSector)
  if (sectorLabel === 'Other' || !isBenchmarkableSector(sectorLabel)) return null

  if (!vsSector?.windows) {
    return (
      <div className="rounded-lg bg-zinc-900/60 px-3 py-2.5 border border-white/[0.04]">
        <p className="type-meta font-semibold text-zinc-400 uppercase tracking-wide">
          Compared to {sectorLabel}
        </p>
        <p className="text-xs text-zinc-500 mt-2" aria-live="polite">
          {refreshing ? 'Loading…' : 'Comparison not ready — pull down to refresh'}
        </p>
      </div>
    )
  }

  const stockRegular1d =
    regularChange1dPct ??
    regularSessionChange1d(stockChange1d, snapshotSession)
  const d1Window = computeLiveD1Window(stockRegular1d, sectorBenchmark ?? null)
  const rsScore =
    d1Window != null
      ? computeRsScoreWithD1({
          d1: d1Window,
          d7: vsSector.windows.d7,
          d14: vsSector.windows.d14,
          d30: vsSector.windows.d30,
        })
      : vsSector.rs_score

  const primaryDelta = vsSector.windows.d7?.delta ?? vsSector.windows.d30?.delta ?? null
  const badgeLabel = vsSectorBadgeLabel(vsSector.badge)
  const etf = vsSector.benchmark_ticker ?? sectorBenchmark?.benchmark_ticker
  const d1Label = d1VsSectorLabel(marketSession)
  const d1Footnote = d1VsSectorFootnote(marketSession)
  const strengthCopy = rsScore != null ? relativeStrengthUserCopy(rsScore) : null

  return (
    <div className="rounded-lg bg-zinc-900/60 px-3 py-2.5 space-y-2 border border-white/[0.04]">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="type-meta font-semibold text-zinc-400 uppercase tracking-wide">
            Compared to {vsSector.sector}
          </p>
          {etf && (
            <p className="type-meta text-zinc-600 mt-0.5 leading-snug">
              {sectorEtfSubtitle(etf, vsSector.sector)}
              {primaryDelta != null && (
                <>
                  {' '}
                  ·{' '}
                  <span className={primaryDelta >= 0 ? 'text-emerald-400/90' : 'text-red-400/90'}>
                    {primaryDelta >= 0 ? 'Ahead by ' : 'Behind by '}
                    {fmtPct(Math.abs(primaryDelta), false)}
                  </span>
                </>
              )}
            </p>
          )}
        </div>
        {badgeLabel && (
          <span
            className={cn(
              'shrink-0 type-micro font-bold uppercase tracking-wide px-2 py-1 rounded-full',
              vsSector.badge === 'leader' && 'bg-emerald-500/15 text-emerald-300',
              vsSector.badge === 'lagger' && 'bg-red-500/15 text-red-300',
              vsSector.badge === 'inline' && 'bg-zinc-700/50 text-zinc-400',
              refreshing && 'opacity-70',
            )}
          >
            {refreshing ? '…' : badgeLabel}
          </span>
        )}
      </div>

      <VsSectorWindowRow label="Past week" window={vsSector.windows.d7} />
      <VsSectorWindowRow label="Past 2 weeks" window={vsSector.windows.d14} />
      <VsSectorWindowRow label="Past month" window={vsSector.windows.d30} />
      {d1Window && (
        <VsSectorWindowRow label={d1Label} window={d1Window} />
      )}

      {strengthCopy && (
        <div className="pt-2 border-t border-white/[0.04] space-y-0.5">
          <p className="type-meta font-medium text-zinc-400">{strengthCopy.title}</p>
          <p className="text-sm font-bold text-zinc-200 tabular-nums">{strengthCopy.tier}</p>
          <p className="type-meta text-zinc-500 leading-relaxed [text-wrap:pretty]">
            {strengthCopy.hint}
          </p>
        </div>
      )}

      {d1Footnote && (
        <p className="type-micro text-zinc-600 leading-relaxed [text-wrap:pretty]">
          {d1Footnote}
          {refreshing ? ' · Updating…' : ''}
        </p>
      )}
    </div>
  )
}
