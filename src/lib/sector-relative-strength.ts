/**
 * Performance vs sector — pure compute (no HTTP/DB).
 *
 * RS 1d delta: client-only using regularMarketChangePercent for stock + sector ETF.
 * Cached windows (7d/14d/30d): server via /api/fundamentals/batch.
 */

import type { MarketSession } from '@/lib/market-hours'
import { normalizeSector, type WatchlistSector } from '@/lib/sectors'
import {
  badgeThresholdForSector,
  isBenchmarkableSector,
  normalizeWatchlistSector,
  RS_DELTA_CAP_PCT,
  RS_SCORE_WEIGHTS,
  RS_SCORE_WEIGHTS_CACHED,
  type BenchmarkableSector,
} from '@/lib/sector-relative-strength-scoring'
import type { SectorBenchmark, SectorRelativeStrength, StockFundamentals, VsSectorWindow } from '@/types'

export type { BenchmarkableSector } from '@/lib/sector-relative-strength-scoring'

export type SectorSource = 'watchlist' | 'resolved' | 'fallback'

function windowDelta(stock: number | null, sector: number | null): VsSectorWindow | null {
  if (stock == null || sector == null) return null
  return { stock, sector, delta: stock - sector }
}

export function sectorBadgeFromDelta(
  delta: number | null,
  sector: BenchmarkableSector,
): 'leader' | 'inline' | 'lagger' | null {
  if (delta == null) return null
  const threshold = badgeThresholdForSector(sector)
  if (delta >= threshold) return 'leader'
  if (delta <= -threshold) return 'lagger'
  return 'inline'
}

function normalizeDeltaToScore(delta: number | null): number | null {
  if (delta == null) return null
  const clamped = Math.max(-RS_DELTA_CAP_PCT, Math.min(RS_DELTA_CAP_PCT, delta))
  return Math.round(((clamped + RS_DELTA_CAP_PCT) / (2 * RS_DELTA_CAP_PCT)) * 100)
}

/** RS score from cached windows only (no d1). */
export function computeRsScoreCached(windows: {
  d7: VsSectorWindow | null
  d14: VsSectorWindow | null
  d30: VsSectorWindow | null
}): number | null {
  const parts: { weight: number; score: number | null }[] = [
    { weight: RS_SCORE_WEIGHTS_CACHED.d30, score: normalizeDeltaToScore(windows.d30?.delta ?? null) },
    { weight: RS_SCORE_WEIGHTS_CACHED.d14, score: normalizeDeltaToScore(windows.d14?.delta ?? null) },
    { weight: RS_SCORE_WEIGHTS_CACHED.d7, score: normalizeDeltaToScore(windows.d7?.delta ?? null) },
  ]

  let totalWeight = 0
  let weighted = 0
  for (const p of parts) {
    if (p.score == null) continue
    totalWeight += p.weight
    weighted += p.weight * p.score
  }
  if (totalWeight <= 0) return null
  return Math.round(weighted / totalWeight)
}

/** Full RS score when regular-session d1 delta is available client-side. */
export function computeRsScoreWithD1(windows: {
  d1: VsSectorWindow | null
  d7: VsSectorWindow | null
  d14: VsSectorWindow | null
  d30: VsSectorWindow | null
}): number | null {
  const parts: { weight: number; score: number | null }[] = [
    { weight: RS_SCORE_WEIGHTS.d30, score: normalizeDeltaToScore(windows.d30?.delta ?? null) },
    { weight: RS_SCORE_WEIGHTS.d14, score: normalizeDeltaToScore(windows.d14?.delta ?? null) },
    { weight: RS_SCORE_WEIGHTS.d7, score: normalizeDeltaToScore(windows.d7?.delta ?? null) },
    { weight: RS_SCORE_WEIGHTS.d1, score: normalizeDeltaToScore(windows.d1?.delta ?? null) },
  ]

  let totalWeight = 0
  let weighted = 0
  for (const p of parts) {
    if (p.score == null) continue
    totalWeight += p.weight
    weighted += p.weight * p.score
  }
  if (totalWeight <= 0) return null
  return Math.round(weighted / totalWeight)
}

export function computeLiveD1Window(
  regularStock1d: number | null,
  benchmark: SectorBenchmark | null,
): VsSectorWindow | null {
  if (regularStock1d == null || benchmark?.change_1d_pct == null) return null
  return windowDelta(regularStock1d, benchmark.change_1d_pct)
}

export function computeVsSector(input: {
  ticker: string
  sector: string | null | undefined
  sectorSource?: SectorSource
  fundamentals: StockFundamentals | null | undefined
  benchmark: SectorBenchmark | null | undefined
}): SectorRelativeStrength {
  const ticker = input.ticker.toUpperCase()
  const sectorSource = input.sectorSource ?? 'watchlist'
  const normalized = normalizeWatchlistSector(input.sector)

  if (normalized === 'Other' || !isBenchmarkableSector(normalized)) {
    return {
      ticker,
      sector: 'Other',
      sector_source: sectorSource,
      benchmark_ticker: null,
      badge: null,
      rs_score: null,
      windows: null,
      benchmark_fetched_at: null,
    }
  }

  const sector = normalized as BenchmarkableSector
  const benchmark = input.benchmark ?? null

  if (!benchmark) {
    return {
      ticker,
      sector,
      sector_source: sectorSource,
      benchmark_ticker: null,
      badge: null,
      rs_score: null,
      windows: null,
      benchmark_fetched_at: null,
    }
  }

  const f = input.fundamentals
  const windows = {
    d7: windowDelta(f?.change_7d_pct ?? null, benchmark.change_7d_pct),
    d14: windowDelta(f?.change_14d_pct ?? null, benchmark.change_14d_pct),
    d30: windowDelta(f?.change_30d_pct ?? null, benchmark.change_30d_pct),
  }

  const badge = sectorBadgeFromDelta(windows.d7?.delta ?? windows.d30?.delta ?? null, sector)
  const rs_score = computeRsScoreCached(windows)

  return {
    ticker,
    sector,
    sector_source: sectorSource,
    benchmark_ticker: benchmark.benchmark_ticker,
    badge,
    rs_score,
    windows,
    benchmark_fetched_at: benchmark.fetched_at,
  }
}

export function computeVsSectorMap(
  tickers: string[],
  sectorsByTicker: Record<string, string | null | undefined>,
  fundamentals: Record<string, StockFundamentals>,
  benchmarks: Partial<Record<BenchmarkableSector, SectorBenchmark>>,
): Record<string, SectorRelativeStrength> {
  const out: Record<string, SectorRelativeStrength> = {}
  for (const raw of tickers) {
    const ticker = raw.toUpperCase()
    const sector = sectorsByTicker[ticker] ?? sectorsByTicker[raw] ?? null
    const normalized = normalizeWatchlistSector(sector)
    const benchmark =
      isBenchmarkableSector(normalized) ? benchmarks[normalized as BenchmarkableSector] : null

    out[ticker] = computeVsSector({
      ticker,
      sector,
      sectorSource: 'watchlist',
      fundamentals: fundamentals[ticker] ?? fundamentals[raw] ?? null,
      benchmark,
    })
  }
  return out
}

/** Label for the 1d vs-sector row — avoids "Today" when the market is closed. */
export function d1VsSectorLabel(session: MarketSession | undefined): string {
  return session === 'regular' ? 'Today' : 'Last trading day'
}

export function d1VsSectorFootnote(_session: MarketSession | undefined): string | null {
  return null
}

/** Regular-session day % for RS. */
export function regularSessionChange1d(
  change1d: number | null | undefined,
  _session: string | undefined,
): number | null {
  return change1d ?? null
}

export function vsSectorSortKey(vs: SectorRelativeStrength | null | undefined): number {
  const delta = vs?.windows?.d7?.delta ?? vs?.windows?.d30?.delta ?? null
  return delta ?? -Infinity
}

export function vsSectorBadgeLabel(badge: SectorRelativeStrength['badge']): string | null {
  if (badge === 'leader') return 'Beating sector'
  if (badge === 'lagger') return 'Behind sector'
  if (badge === 'inline') return 'Similar to sector'
  return null
}

/** Short line explaining what the sector ETF ticker is (e.g. XLF). */
export function sectorEtfSubtitle(etf: string, sector: string): string {
  return `${etf} tracks other ${sector} stocks — we compare this one to that group`
}

/** Plain label for a vs-sector time window spread line. */
export function vsSectorSpreadLabel(window: '7d' | '30d'): string {
  return window === '7d' ? 'Past week' : 'Past month'
}

/** Retail-friendly copy for the blended relative-strength score (0–100). */
export function relativeStrengthUserCopy(score: number): {
  title: string
  tier: string
  hint: string
} {
  let tier: string
  let hint: string
  if (score >= 70) {
    tier = 'Doing well'
    hint = 'Has been stronger than most peers in its sector lately'
  } else if (score >= 55) {
    tier = 'A bit ahead'
    hint = 'Slightly ahead of other stocks in its sector'
  } else if (score >= 45) {
    tier = 'About average'
    hint = 'Moving in line with other stocks in its sector'
  } else if (score >= 30) {
    tier = 'A bit behind'
    hint = 'Slightly weaker than other stocks in its sector'
  } else {
    tier = 'Weak lately'
    hint = 'Has lagged other stocks in its sector recently'
  }
  return {
    title: 'Compared to its sector',
    tier,
    hint,
  }
}

export function resolveSectorLabel(sector: WatchlistSector): string {
  return normalizeSector(sector)
}
