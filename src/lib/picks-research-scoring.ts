/**
 * Key research inputs for picks scoring — read from stock_research_cache only (no live API).
 */

import { isBenchmarkableSector, normalizeWatchlistSector } from '@/lib/sector-relative-strength-scoring'
import type { PickFactor, PickSourceTag, StockResearchSnapshot } from '@/types'

export const PICKS_RESEARCH_RULES = {
  /** Hard exclude when earnings is 0–N calendar days away (inclusive). */
  earningsExcludeDays: 5,
  /** Min peer count with valid P/E to compute sector median. */
  sectorPeMinPeers: 3,
  /** P/E vs sector median ratio thresholds. */
  sectorPe: {
    cheapRatio: 0.85,
    cheapPoints: 5,
    expensiveRatio: 1.5,
    expensivePoints: -6,
    veryExpensiveRatio: 2.0,
    veryExpensivePoints: -10,
  },
  revenueGrowth: {
    strongMin: 15,
    strongPoints: 8,
    moderateMin: 5,
    moderatePoints: 4,
    weakMax: -10,
    weakPenalty: -6,
  },
  profitMargin: {
    healthyMin: 15,
    healthyPoints: 6,
    positiveMin: 0,
    positivePoints: 3,
    deepLossMax: -20,
    deepLossPenalty: -8,
  },
  epsGrowth: { strongMin: 10, points: 5 },
  balanceSheet: {
    lowDebtMax: 1,
    lowDebtPoints: 4,
    highDebtMin: 2.5,
    highDebtPenalty: -5,
    strongLiquidityMin: 1.5,
    strongLiquidityPoints: 3,
  },
  absolutePe: {
    reasonableMin: 8,
    reasonableMax: 25,
    reasonablePoints: 4,
    stretchedMin: 50,
    stretchedPenalty: -4,
  },
  /** Total research contribution clamped to this range. */
  maxAbsContribution: 20,
} as const

export type ResearchScoringContext = {
  research: StockResearchSnapshot | null
  /** Sector median trailing P/E from cached research peers (same batch). */
  sectorPeMedian: number | null
}

export function daysUntilCalendarDate(isoDate: string | null | undefined): number | null {
  if (!isoDate) return null
  const target = new Date(`${isoDate}T12:00:00`)
  if (Number.isNaN(target.getTime())) return null
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

/** Hard gate — exclude pick when earnings within N days. */
export function isEarningsExclusionWindow(
  research: StockResearchSnapshot | null,
  excludeDays = PICKS_RESEARCH_RULES.earningsExcludeDays,
): boolean {
  const days = daysUntilCalendarDate(research?.earnings_date)
  if (days == null) return false
  return days >= 0 && days <= excludeDays
}

/** Momentum synthetic target requires profitable or growing business when research exists. */
export function passesMomentumQualityGate(research: StockResearchSnapshot | null): boolean {
  if (!research) return false
  const profitable = (research.profit_margin_pct ?? Number.NEGATIVE_INFINITY) > 0
  const growing = (research.revenue_growth_pct ?? Number.NEGATIVE_INFINITY) > 0
  return profitable || growing
}

/** Discovery strong movers: when research exists, require quality floor. */
export function passesDiscoveryResearchQualityGate(research: StockResearchSnapshot | null): boolean {
  if (!research) return true
  return passesMomentumQualityGate(research)
}

export function computeSectorPeMedians(
  researchByTicker: Map<string, StockResearchSnapshot>,
  sectorByTicker: Map<string, string | null | undefined>,
): Map<string, number> {
  const rules = PICKS_RESEARCH_RULES
  const peBySector = new Map<string, number[]>()

  for (const [ticker, snap] of researchByTicker) {
    const sector = normalizeWatchlistSector(sectorByTicker.get(ticker.toUpperCase()))
    if (!isBenchmarkableSector(sector)) continue
    const pe = snap.pe_trailing
    if (pe == null || pe <= 0) continue
    const list = peBySector.get(sector) ?? []
    list.push(pe)
    peBySector.set(sector, list)
  }

  const medians = new Map<string, number>()
  for (const [sector, pes] of peBySector) {
    if (pes.length < rules.sectorPeMinPeers) continue
    const sorted = [...pes].sort((a, b) => a - b)
    const mid = Math.floor(sorted.length / 2)
    const median =
      sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2
    medians.set(sector, median)
  }
  return medians
}

export function sectorPeMedianForTicker(
  sector: string | null | undefined,
  sectorPeMedians: Map<string, number>,
): number | null {
  const normalized = normalizeWatchlistSector(sector)
  if (!isBenchmarkableSector(normalized)) return null
  return sectorPeMedians.get(normalized) ?? null
}

export function applyResearchScore(
  ctx: ResearchScoringContext,
  sector: string | null,
  factors: PickFactor[],
): number {
  const r = ctx.research
  if (!r) return 0

  const rules = PICKS_RESEARCH_RULES
  let delta = 0

  const rev = r.revenue_growth_pct
  if (rev != null) {
    if (rev > rules.revenueGrowth.strongMin) {
      delta += rules.revenueGrowth.strongPoints
      factors.push({ label: 'Strong revenue YoY', value: `+${rev.toFixed(0)}%`, tone: 'positive' })
    } else if (rev > rules.revenueGrowth.moderateMin) {
      delta += rules.revenueGrowth.moderatePoints
      factors.push({ label: 'Solid revenue YoY', value: `+${rev.toFixed(0)}%`, tone: 'positive' })
    } else if (rev < rules.revenueGrowth.weakMax) {
      delta += rules.revenueGrowth.weakPenalty
      factors.push({ label: 'Revenue contracting YoY', value: `${rev.toFixed(0)}%`, tone: 'negative' })
    }
  }

  const margin = r.profit_margin_pct
  if (margin != null) {
    if (margin > rules.profitMargin.healthyMin) {
      delta += rules.profitMargin.healthyPoints
      factors.push({ label: 'Healthy profit margin', value: `${margin.toFixed(0)}%`, tone: 'positive' })
    } else if (margin > rules.profitMargin.positiveMin) {
      delta += rules.profitMargin.positivePoints
    } else if (margin < rules.profitMargin.deepLossMax) {
      delta += rules.profitMargin.deepLossPenalty
      factors.push({ label: 'Deep losses', value: `${margin.toFixed(0)}% margin`, tone: 'negative' })
    }
  }

  const eps = r.earnings_growth_pct
  if (eps != null && eps > rules.epsGrowth.strongMin) {
    delta += rules.epsGrowth.points
    factors.push({ label: 'EPS growing YoY', value: `+${eps.toFixed(0)}%`, tone: 'positive' })
  }

  const dte = r.debt_to_equity
  if (dte != null) {
    if (dte < rules.balanceSheet.lowDebtMax) delta += rules.balanceSheet.lowDebtPoints
    else if (dte > rules.balanceSheet.highDebtMin) {
      delta += rules.balanceSheet.highDebtPenalty
      factors.push({ label: 'High leverage', value: `${dte.toFixed(1)}× debt/equity`, tone: 'negative' })
    }
  }

  const cr = r.current_ratio
  if (cr != null && cr > rules.balanceSheet.strongLiquidityMin) {
    delta += rules.balanceSheet.strongLiquidityPoints
  }

  const pe = r.pe_trailing
  if (pe != null && pe > 0) {
    if (pe >= rules.absolutePe.reasonableMin && pe <= rules.absolutePe.reasonableMax) {
      delta += rules.absolutePe.reasonablePoints
    } else if (pe >= rules.absolutePe.stretchedMin) {
      delta += rules.absolutePe.stretchedPenalty
      factors.push({ label: 'Stretched P/E', value: pe.toFixed(0), tone: 'negative' })
    }

    const median = ctx.sectorPeMedian
    if (median != null && median > 0) {
      const ratio = pe / median
      if (ratio <= rules.sectorPe.cheapRatio) {
        delta += rules.sectorPe.cheapPoints
        factors.push({
          label: 'Cheaper vs sector P/E',
          value: `${pe.toFixed(0)} vs ${median.toFixed(0)} med`,
          tone: 'positive',
        })
      } else if (ratio >= rules.sectorPe.veryExpensiveRatio) {
        delta += rules.sectorPe.veryExpensivePoints
        factors.push({
          label: 'Very expensive vs sector',
          value: `${ratio.toFixed(1)}× sector median P/E`,
          tone: 'negative',
        })
      } else if (ratio >= rules.sectorPe.expensiveRatio) {
        delta += rules.sectorPe.expensivePoints
        factors.push({
          label: 'Rich vs sector P/E',
          value: `${ratio.toFixed(1)}× sector median`,
          tone: 'negative',
        })
      }
    }
  }

  return Math.max(
    -rules.maxAbsContribution,
    Math.min(rules.maxAbsContribution, delta),
  )
}

/** Whether a momentum-derived target is allowed for this candidate. */
export function allowMomentumTarget(
  source: PickSourceTag,
  research: StockResearchSnapshot | null,
): boolean {
  if (source === 'discovery' && !research) return false
  if (!research) return source !== 'discovery'
  return passesMomentumQualityGate(research)
}
