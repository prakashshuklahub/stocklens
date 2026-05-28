import { daysUntilCalendarDate } from '@/lib/picks-research-scoring'
import { PORTFOLIO_SUMMARY_TAG_LABELS } from '@/lib/portfolio-summary-tags'
import {
  computeTargetUpsidePct,
  hasDisplayTargetPrice,
} from '@/lib/target-price-display'
import type { SignalNewsItem } from '@/types'
import type {
  HoldingSignalTier,
  PickFactor,
  PortfolioSummaryTag,
  StockFundamentals,
  StockResearchSnapshot,
} from '@/types'

export type PortfolioBriefingRole = 'leader' | 'laggard' | 'anchor' | 'quiet'

export type PortfolioDayTone = 'strong_up' | 'up' | 'flat' | 'down' | 'strong_down' | 'unknown'

export interface PortfolioBriefingEditorial {
  /** One-line analytical angle — interpretation, not statistics. */
  lead: string
  /** What shifted relative to the recent backdrop. */
  what_changed: string | null
  /** Upcoming event or developing narrative worth noting. */
  catalyst: string | null
  /** Material risk or constraint — only when warranted. */
  caution: string | null
  /** Concrete facts: headlines, deals, earnings — cite in the summary. */
  material_updates: string[]
  /** Curated metrics worth weaving in (max ~2 per summary) — not a stat dump. */
  key_metrics: string[]
}

export const BRIEFING_DO_NOT_REPEAT = [
  'listing every card stat in a row',
  'opening the summary with a bare percentage',
] as const

export function portfolioDayTone(dayPct: number | null): PortfolioDayTone {
  if (dayPct == null) return 'unknown'
  if (dayPct >= 2) return 'strong_up'
  if (dayPct >= 0.3) return 'up'
  if (dayPct <= -2) return 'strong_down'
  if (dayPct <= -0.3) return 'down'
  return 'flat'
}

export function holdingRoleToday(
  ticker: string,
  weightPct: number,
  leaders: string[],
  laggards: string[],
): PortfolioBriefingRole {
  if (leaders.includes(ticker)) return 'leader'
  if (laggards.includes(ticker)) return 'laggard'
  if (weightPct >= 12) return 'anchor'
  return 'quiet'
}

function firstSentence(text: string | null | undefined): string | null {
  if (!text?.trim()) return null
  const s = text.trim().split('.')[0]?.trim()
  return s ? `${s}.` : null
}

const MATERIAL_HEADLINE_KEYWORDS = [
  'deal',
  'contract',
  'partnership',
  'agreement',
  'acquisition',
  'merger',
  'signed',
  'wins',
  'award',
  'license',
  'order',
  'backlog',
  'target',
  'upgrade',
  'downgrade',
  'beat',
  'miss',
  'guidance',
  'earnings',
  'revenue',
  'forecast',
  'outlook',
  'investment',
  'funding',
  'ipo',
  'buyback',
  'dividend',
  'fda',
  'approval',
  'launch',
]

function headlineMaterialScore(title: string): number {
  const lower = title.toLowerCase()
  let score = 0
  for (const kw of MATERIAL_HEADLINE_KEYWORDS) {
    if (lower.includes(kw)) score += 1
  }
  return score
}

function rankHeadlinesByMateriality(items: SignalNewsItem[]): SignalNewsItem[] {
  return [...items].sort((a, b) => {
    const scoreDiff = headlineMaterialScore(b.title) - headlineMaterialScore(a.title)
    if (scoreDiff !== 0) return scoreDiff
    return new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  })
}

export function buildMaterialUpdates(input: {
  headlines: SignalNewsItem[]
  price: number | null
  fundamentals: StockFundamentals | null
  research: StockResearchSnapshot | null
  signal_factors: PickFactor[]
  tags: PortfolioSummaryTag[]
}): string[] {
  const updates: string[] = []
  const ranked = rankHeadlinesByMateriality(input.headlines)

  for (const h of ranked.slice(0, 2)) {
    if (!h.title.trim()) continue
    updates.push(`Headline: ${h.title}`)
  }

  const days = daysUntilCalendarDate(input.research?.earnings_date)
  if (days != null && days >= 0 && days <= 21) {
    updates.push(
      days <= 3
        ? `Earnings report imminent (${input.research!.earnings_date})`
        : `Next earnings in ${days} days (${input.research!.earnings_date})`,
    )
  }

  if (input.research?.revenue_growth_pct != null && Math.abs(input.research.revenue_growth_pct) >= 12) {
    updates.push(`Revenue growth ~${input.research.revenue_growth_pct.toFixed(0)}% year over year`)
  }
  if (input.research?.earnings_growth_pct != null && Math.abs(input.research.earnings_growth_pct) >= 15) {
    updates.push(`Earnings growth ~${input.research.earnings_growth_pct.toFixed(0)}% year over year`)
  }

  for (const factor of input.signal_factors.slice(0, 2)) {
    const line = factor.value ? `${factor.label} (${factor.value})` : factor.label
    if (!updates.some((u) => u.startsWith(line.slice(0, 20)))) updates.push(line)
  }

  if (input.tags.includes('target_raised')) {
    updates.push('Analyst price targets were recently raised')
  }
  if (input.tags.includes('target_cut')) {
    updates.push('Analyst price targets were recently reduced')
  }
  if (input.tags.includes('analyst_upgrade')) {
    updates.push('Recent analyst upgrade activity')
  }
  if (input.tags.includes('analyst_downgrade')) {
    updates.push('Recent analyst downgrade activity')
  }

  return updates.slice(0, 6)
}

export function buildKeyMetrics(input: {
  change_1d_pct: number | null
  change_7d_pct: number | null
  change_30d_pct: number | null
  position_pnl_pct: number | null
  role_today: PortfolioBriefingRole
  fundamentals: StockFundamentals | null
  price: number | null
  tags: PortfolioSummaryTag[]
  signal_tier: HoldingSignalTier
  research: StockResearchSnapshot | null
}): string[] {
  const metrics: string[] = []
  const d1 = input.change_1d_pct
  const d7 = input.change_7d_pct
  const d30 = input.change_30d_pct
  const pnl = input.position_pnl_pct
  const f = input.fundamentals

  const dayContrastsTrend =
    d1 != null &&
    d30 != null &&
    ((d1 <= -1 && d30 >= 8) || (d1 >= 2 && d30 <= -5))
  const includeDay =
    d1 != null &&
    (Math.abs(d1) >= 1.5 ||
      input.role_today === 'leader' ||
      input.role_today === 'laggard' ||
      dayContrastsTrend)
  if (includeDay) metrics.push(`Today ${d1! >= 0 ? '+' : ''}${d1!.toFixed(1)}%`)

  const include30d =
    d30 != null && (Math.abs(d30) >= 10 || dayContrastsTrend)
  if (include30d) metrics.push(`30-day ${d30! >= 0 ? '+' : ''}${d30!.toFixed(0)}%`)

  if (d7 != null && Math.abs(d7) >= 5 && !include30d) {
    metrics.push(`7-day ${d7 >= 0 ? '+' : ''}${d7.toFixed(1)}%`)
  }

  if (pnl != null && (Math.abs(pnl) >= 15 || input.signal_tier === 'profit' || input.signal_tier === 'attention')) {
    metrics.push(`Position ${pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}% vs average cost`)
  }

  const buy = f?.analyst_buy ?? 0
  const sell = f?.analyst_sell ?? 0
  const hold = f?.analyst_hold ?? 0
  const total = buy + hold + sell
  if (
    total >= 5 &&
    (input.tags.includes('strong_buy_ratings') ||
      input.tags.includes('heavy_sell_ratings') ||
      buy / total >= 0.55 ||
      sell / total >= 0.25)
  ) {
    metrics.push(`Analysts ${buy} buy / ${sell} sell`)
  }

  if (f && input.price != null && hasDisplayTargetPrice(f.target_price, f.target_source)) {
    const target = f.target_price!
    const upside = computeTargetUpsidePct(target, input.price)
    const band =
      f.target_low != null && f.target_high != null
        ? `, range $${f.target_low.toFixed(0)}–$${f.target_high.toFixed(0)}`
        : ''
    if (upside != null) {
      metrics.push(
        `Target $${target.toFixed(0)}${band} (${upside >= 0 ? '+' : ''}${upside.toFixed(0)}% vs price)`,
      )
    } else {
      metrics.push(`Target $${target.toFixed(0)}${band}`)
    }
  }

  const earningsDays = daysUntilCalendarDate(input.research?.earnings_date)
  if (earningsDays != null && earningsDays >= 0 && earningsDays <= 14) {
    metrics.push(`Earnings in ${earningsDays} days`)
  }

  return metrics.slice(0, 5)
}

function tagLabel(tag: PortfolioSummaryTag): string {
  return PORTFOLIO_SUMMARY_TAG_LABELS[tag].toLowerCase()
}

function momentumStory(
  d1: number | null,
  d7: number | null,
  d30: number | null,
): { lead: string | null; what_changed: string | null } {
  if (d1 != null && d30 != null && d1 <= -1.5 && d30 >= 15) {
    return {
      lead: 'Decline appears consistent with consolidation after an extended advance, not a breakdown in the trend',
      what_changed: 'First notable pullback following a sustained re-rating over recent weeks',
    }
  }
  if (d1 != null && d30 != null && d1 >= 2 && d30 <= -8) {
    return {
      lead: 'Session rebound offers relief, but the intermediate trend remains under pressure',
      what_changed: 'Short-term buying emerged after a weak stretch; a durable reversal is not yet established',
    }
  }
  if (d1 != null && d1 >= 3 && d7 != null && d7 >= 5) {
    return {
      lead: 'Price action shows sustained momentum across consecutive sessions',
      what_changed: 'Strength extends through the past week rather than reflecting an isolated move',
    }
  }
  if (d30 != null && d30 <= -12) {
    return {
      lead: 'Persistent weakness has dominated the intermediate timeframe',
      what_changed: 'The decline extends beyond a single session; evidence of stabilization remains limited',
    }
  }
  if (d1 != null && Math.abs(d1) < 0.4 && (d7 == null || Math.abs(d7) < 2)) {
    return {
      lead: 'Session was largely uneventful relative to recent activity',
      what_changed: null,
    }
  }
  return { lead: null, what_changed: null }
}

function catalystFromTagsAndResearch(
  tags: PortfolioSummaryTag[],
  research: StockResearchSnapshot | null,
): string | null {
  const days = daysUntilCalendarDate(research?.earnings_date)
  if (days != null && days >= 0 && days <= 14) {
    if (days <= 3) return 'Earnings report is imminent; expect elevated volatility around the release'
    if (tags.includes('earnings_soon')) {
      return `Earnings in approximately ${days} days; positioning typically shifts ahead of the report`
    }
  }
  if (tags.includes('earnings_beat')) {
    return 'Prior quarter exceeded expectations; the market may hold management to a higher bar'
  }
  if (tags.includes('earnings_miss')) {
    return 'Prior quarter disappointed; sentiment may remain cautious until guidance improves'
  }
  if (tags.includes('target_raised')) {
    return 'Recent target increases suggest the Street is revisiting its valuation framework'
  }
  if (tags.includes('target_cut')) {
    return 'Target reductions imply the market requires fresh evidence before re-engaging'
  }
  if (tags.includes('analyst_upgrade')) {
    return 'Recent upgrade activity may draw incremental institutional attention'
  }
  if (tags.includes('analyst_downgrade')) {
    return 'Recent downgrades add a layer of skepticism despite stable price action'
  }
  if (tags.includes('positive_news')) {
    return 'News flow has turned constructive; sentiment may be catching up to recent price action'
  }
  if (tags.includes('negative_news')) {
    return 'Negative headlines are accumulating; the narrative warrants close attention'
  }
  if (tags.includes('weak_guidance')) {
    return 'Management guidance fell short of expectations; recovery may require more than one quarter'
  }
  return null
}

function cautionFromSignal(
  signalTier: HoldingSignalTier,
  tags: PortfolioSummaryTag[],
  existingReview: string | null,
): string | null {
  if (existingReview) {
    const s = firstSentence(existingReview)
    if (s) {
      return s.replace(
        /^You own \d+ shares of \w+ at an average cost of \$[\d.]+; the stock is at \$[\d.]+, so you are up [\d.]+% versus what you paid\.\s*/i,
        '',
      )
    }
  }
  if (signalTier === 'attention') {
    return 'Multiple bearish signals are converging; the case for near-term recovery remains unconfirmed'
  }
  if (signalTier === 'profit' || tags.includes('profit_target_reached')) {
    return 'Price trades near consensus targets; much of the base-case upside may already be reflected'
  }
  if (tags.includes('heavy_sell_ratings')) {
    return 'Analyst sentiment skews negative; that divergence can cap rallies even on constructive days'
  }
  if (tags.includes('near_52w_low')) {
    return 'Trading near annual lows; the market has not yet established a durable support level'
  }
  if (tags.includes('near_52w_high')) {
    return 'Trading near annual highs; positive developments may be largely priced in at these levels'
  }
  return null
}

export function buildHoldingEditorial(input: {
  change_1d_pct: number | null
  change_7d_pct: number | null
  change_30d_pct: number | null
  tags: PortfolioSummaryTag[]
  signal_tier: HoldingSignalTier
  research: StockResearchSnapshot | null
  fundamentals: StockFundamentals | null
  existing_review_reason: string | null
  role_today: PortfolioBriefingRole
  headlines: SignalNewsItem[]
  price: number | null
  position_pnl_pct: number | null
  signal_factors: PickFactor[]
}): PortfolioBriefingEditorial {
  const { tags, signal_tier, research, existing_review_reason, role_today } = input
  const d1 = input.change_1d_pct
  const d7 = input.change_7d_pct ?? input.fundamentals?.change_7d_pct ?? null
  const d30 = input.change_30d_pct ?? input.fundamentals?.change_30d_pct ?? null

  const caution = cautionFromSignal(signal_tier, tags, existing_review_reason)
  const momentum = momentumStory(d1, d7, d30)

  let lead = momentum.lead
  let what_changed = momentum.what_changed

  if (role_today === 'leader' && !lead) {
    lead = 'Among the primary contributors to portfolio performance in today\'s session'
    what_changed = what_changed ?? 'Outperformed other holdings on a day with meaningful dispersion'
  }
  if (role_today === 'laggard' && !lead) {
    lead = 'Among the primary detractors in today\'s session'
    what_changed = what_changed ?? 'Underperformed the rest of the portfolio; assess whether the move is idiosyncratic or sector-wide'
  }

  if (!lead && tags.includes('strong_momentum')) {
    lead = 'Intermediate trend remains constructive; price action has been orderly to the upside'
  }
  if (!lead && tags.includes('weak_momentum')) {
    lead = 'Intermediate trend remains adverse; stabilization has not yet taken hold'
  }
  if (!lead && tags.includes('strong_buy_ratings')) {
    lead = 'Fundamental case retains broad analyst support; the debate centers on timing and valuation'
  }
  if (!lead) {
    lead = 'No material change to the prevailing narrative; existing thesis remains intact'
  }

  const material_updates = buildMaterialUpdates({
    headlines: input.headlines,
    price: input.price,
    fundamentals: input.fundamentals,
    research,
    signal_factors: input.signal_factors,
    tags,
  })

  const key_metrics = buildKeyMetrics({
    change_1d_pct: d1,
    change_7d_pct: d7,
    change_30d_pct: d30,
    position_pnl_pct: input.position_pnl_pct,
    role_today,
    fundamentals: input.fundamentals,
    price: input.price,
    tags,
    signal_tier,
    research,
  })

  // Prefer headline-driven catalyst when a specific story exists
  let catalyst = catalystFromTagsAndResearch(tags, research)
  const topHeadline = material_updates.find((u) => u.startsWith('Headline:'))
  if (topHeadline && headlineMaterialScore(topHeadline.replace(/^Headline:\s*/, '')) >= 2) {
    catalyst = `Recent coverage: ${topHeadline.replace(/^Headline:\s*/, '')}`
  }

  return {
    lead,
    what_changed,
    catalyst,
    caution,
    material_updates,
    key_metrics,
  }
}

export function editorialTagsForPrompt(tags: PortfolioSummaryTag[]): string[] {
  return tags.slice(0, 4).map(tagLabel)
}
