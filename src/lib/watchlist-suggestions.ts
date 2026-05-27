// Trending card scoring re-exports — narrative copy lives in @/lib/stock-narratives (same as Picks).

export type { ScoredSuggestion, TrendingScoreInput } from '@/lib/watchlist-suggestions-scoring'
export type { TrendingNarrative } from '@/types'
export {
  rankTrendingSuggestions,
  scoreTrendingCandidate,
  trendingHeadline,
  TRENDING_GLOBAL_RANK_LIMIT,
  TRENDING_MIN_SCORE,
  TRENDING_MAX_SCORE,
  TRENDING_STRONG_SCORE,
  TRENDING_STRONG_MIN_SLOTS,
  TRENDING_SCORING_RULES,
} from '@/lib/watchlist-suggestions-scoring'
