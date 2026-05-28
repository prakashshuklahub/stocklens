import { daysUntilCalendarDate } from '@/lib/picks-research-scoring'
import { ALERT_RULES } from '@/lib/portfolio-alert-scoring'
import {
  computeTargetUpsidePct,
  hasDisplayTargetPrice,
} from '@/lib/target-price-display'
import type {
  HoldingSignalTier,
  PortfolioSummarySentiment,
  PortfolioSummaryTag,
  StockFundamentals,
  StockResearchSnapshot,
} from '@/types'

export const PORTFOLIO_SUMMARY_TAG_LABELS: Record<PortfolioSummaryTag, string> = {
  earnings_beat: 'Earnings Beat',
  earnings_miss: 'Earnings Miss',
  earnings_soon: 'Earnings Soon',
  target_raised: 'Target Raised',
  target_cut: 'Target Cut',
  weak_guidance: 'Weak Guidance',
  strong_momentum: 'Strong Momentum',
  weak_momentum: 'Weak Momentum',
  analyst_upgrade: 'Analyst Upgrade',
  analyst_downgrade: 'Analyst Downgrade',
  heavy_sell_ratings: 'Heavy Sell Ratings',
  strong_buy_ratings: 'Strong Buy Ratings',
  negative_news: 'Negative News',
  positive_news: 'Positive News',
  near_52w_high: 'Near 52W High',
  near_52w_low: 'Near 52W Low',
  profit_target_reached: 'Target Reached',
}

/** Lower index = higher priority when capping at 4 tags. */
export const TAG_PRIORITY: PortfolioSummaryTag[] = [
  'earnings_soon',
  'earnings_beat',
  'earnings_miss',
  'analyst_upgrade',
  'analyst_downgrade',
  'target_raised',
  'target_cut',
  'weak_guidance',
  'profit_target_reached',
  'heavy_sell_ratings',
  'strong_buy_ratings',
  'strong_momentum',
  'weak_momentum',
  'positive_news',
  'negative_news',
  'near_52w_high',
  'near_52w_low',
]

const TAG_PRIORITY_INDEX = new Map(TAG_PRIORITY.map((t, i) => [t, i]))

export function pickTopTags(candidates: PortfolioSummaryTag[], max = 4): PortfolioSummaryTag[] {
  const unique = [...new Set(candidates)]
  unique.sort((a, b) => (TAG_PRIORITY_INDEX.get(a) ?? 99) - (TAG_PRIORITY_INDEX.get(b) ?? 99))
  return unique.slice(0, max)
}

export type SummaryTagInput = {
  change_1d_pct: number | null
  change_7d_pct: number | null
  change_30d_pct: number | null
  position_pnl_pct: number | null
  price: number | null
  fundamentals: StockFundamentals | null
  research: StockResearchSnapshot | null
  signal_tier: HoldingSignalTier
}

export function deriveSummaryTags(input: SummaryTagInput): PortfolioSummaryTag[] {
  const tags: PortfolioSummaryTag[] = []
  const f = input.fundamentals
  const r = input.research

  const days = daysUntilCalendarDate(r?.earnings_date)
  if (days != null && days >= 0 && days <= 7) tags.push('earnings_soon')

  const d30 = input.change_30d_pct ?? f?.change_30d_pct
  const d7 = input.change_7d_pct ?? f?.change_7d_pct
  const d1 = input.change_1d_pct

  if (d30 != null && d30 >= 10) tags.push('strong_momentum')
  else if (d7 != null && d7 >= 5 && (d1 ?? 0) >= 0) tags.push('strong_momentum')
  if (d30 != null && d30 <= -10) tags.push('weak_momentum')
  else if (d7 != null && d7 <= -8) tags.push('weak_momentum')

  const buy = f?.analyst_buy ?? 0
  const hold = f?.analyst_hold ?? 0
  const sell = f?.analyst_sell ?? 0
  const total = buy + hold + sell
  if (total >= ALERT_RULES.analyst.heavySell.minAnalysts && sell / total >= ALERT_RULES.analyst.heavySell.minSellRatio) {
    tags.push('heavy_sell_ratings')
  }
  if (total >= ALERT_RULES.analyst.strongBuy.minAnalysts && buy / total >= ALERT_RULES.analyst.strongBuy.minBuyRatio) {
    tags.push('strong_buy_ratings')
  }

  const sentiment = f?.news_sentiment
  if (sentiment != null && sentiment >= 0.25) tags.push('positive_news')
  if (sentiment != null && sentiment <= -0.25) tags.push('negative_news')

  if (f?.week52_high != null && input.price != null && input.price >= f.week52_high * 0.95) {
    tags.push('near_52w_high')
  }
  if (f?.week52_low != null && input.price != null && input.price <= f.week52_low * 1.05) {
    tags.push('near_52w_low')
  }

  if (input.signal_tier === 'profit') tags.push('profit_target_reached')

  if (
    hasDisplayTargetPrice(f?.target_price ?? null, f?.target_source ?? null) &&
    input.price != null
  ) {
    const upside = computeTargetUpsidePct(f!.target_price, input.price)
    if (upside != null && upside <= 5) tags.push('target_cut')
  }

  return pickTopTags(tags)
}

export function sentimentFromMetrics(input: {
  change_1d_pct: number | null
  change_30d_pct: number | null
  position_pnl_pct: number | null
  tags: PortfolioSummaryTag[]
  signal_tier: HoldingSignalTier
}): PortfolioSummarySentiment {
  if (input.signal_tier === 'attention') return 'negative'
  if (input.signal_tier === 'profit') return 'positive'

  let score = 0
  if (input.change_1d_pct != null) {
    if (input.change_1d_pct >= 1) score += 1
    else if (input.change_1d_pct <= -1) score -= 1
  }
  if (input.change_30d_pct != null) {
    if (input.change_30d_pct >= 8) score += 1
    else if (input.change_30d_pct <= -8) score -= 1
  }
  if (input.position_pnl_pct != null) {
    if (input.position_pnl_pct >= 15) score += 1
    else if (input.position_pnl_pct <= -15) score -= 1
  }
  if (input.tags.includes('heavy_sell_ratings') || input.tags.includes('weak_momentum')) score -= 1
  if (input.tags.includes('strong_buy_ratings') || input.tags.includes('strong_momentum')) score += 1

  if (score >= 1) return 'positive'
  if (score <= -1) return 'negative'
  return 'neutral'
}

export function aggregatePortfolioSentiment(
  holdings: { sentiment: PortfolioSummarySentiment; weight_pct: number }[],
): PortfolioSummarySentiment {
  let weighted = 0
  for (const h of holdings) {
    const s = h.sentiment === 'positive' ? 1 : h.sentiment === 'negative' ? -1 : 0
    weighted += h.weight_pct * s
  }
  if (weighted > 0.15) return 'positive'
  if (weighted < -0.15) return 'negative'
  return 'neutral'
}
