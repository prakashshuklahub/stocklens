/**
 * Performance vs sector — tunable constants.
 * RS score uses regular-session 1d only when computed client-side with live quotes.
 */

import type { WatchlistSector } from '@/lib/sectors'

export const BENCHMARKABLE_SECTORS = [
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
] as const

export type BenchmarkableSector = (typeof BENCHMARKABLE_SECTORS)[number]

/** Weights for full RS score (must sum to 1). d1 applied client-side with regular quotes. */
export const RS_SCORE_WEIGHTS = {
  d30: 0.4,
  d14: 0.25,
  d7: 0.2,
  d1: 0.15,
} as const

const _weightSum =
  RS_SCORE_WEIGHTS.d30 + RS_SCORE_WEIGHTS.d14 + RS_SCORE_WEIGHTS.d7 + RS_SCORE_WEIGHTS.d1
if (Math.abs(_weightSum - 1) > 0.001) {
  throw new Error(`RS_SCORE_WEIGHTS must sum to 1.0, got ${_weightSum}`)
}

/** Renormalized weights when d1 is excluded from server-side RS (cached batch). */
export const RS_SCORE_WEIGHTS_CACHED = {
  d30: RS_SCORE_WEIGHTS.d30 / (1 - RS_SCORE_WEIGHTS.d1),
  d14: RS_SCORE_WEIGHTS.d14 / (1 - RS_SCORE_WEIGHTS.d1),
  d7: RS_SCORE_WEIGHTS.d7 / (1 - RS_SCORE_WEIGHTS.d1),
} as const

/** Phase 1 flat threshold — sector-specific thresholds in Phase 2. */
export const DEFAULT_BADGE_THRESHOLD_PCT = 2

/** Known limitation: flat ±2% across sectors until volatility-adjusted thresholds ship. */
export const SECTOR_BADGE_THRESHOLDS: Partial<Record<BenchmarkableSector, number>> = {
  Technology: 3,
  Utilities: 1.5,
}

export function badgeThresholdForSector(sector: BenchmarkableSector): number {
  return SECTOR_BADGE_THRESHOLDS[sector] ?? DEFAULT_BADGE_THRESHOLD_PCT
}

export function isBenchmarkableSector(sector: string | null | undefined): sector is BenchmarkableSector {
  return Boolean(sector && (BENCHMARKABLE_SECTORS as readonly string[]).includes(sector))
}

export function normalizeWatchlistSector(sector: string | null | undefined): WatchlistSector {
  const trimmed = sector?.trim()
  if (!trimmed) return 'Other'
  if (trimmed === 'Other') return 'Other'
  if (isBenchmarkableSector(trimmed)) return trimmed
  return 'Other'
}

export const PICKS_VS_SECTOR_RULES = {
  strongRsMin: 65,
  strongRsPoints: 6,
  weakRsMax: 35,
  weakRsPenalty: 4,
  beatMinDelta: 2,
  beatPoints: 5,
  lagMaxDelta: -2,
  lagPenalty: 3,
} as const

export const TRENDING_VS_SECTOR_RULES = {
  beatMinDelta: 2,
  beatPoints: 8,
  lagMaxDelta: -1,
  lagPenalty: 6,
} as const

/** Map delta to 0–100 RS score (±15% spread → 0–100). */
export const RS_DELTA_CAP_PCT = 15
