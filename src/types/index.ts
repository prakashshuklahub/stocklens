import type { MarketSession } from '@/lib/market-hours'

export type { MarketSession }

export interface User {
  id: string
  email: string
  name: string | null
  avatar_url: string | null
  created_at: string
}

export interface AllowedEmail {
  id: string
  email: string
  added_at: string
}

export interface WatchlistStock {
  id: string
  user_id: string
  ticker: string
  company_name: string
  sector: string | null
  added_at: string
}

export interface StockSnapshot {
  price: number | null
  change_1d_pct: number | null
  /** pre | regular | post | closed — from Yahoo marketState */
  session?: MarketSession
  /** @deprecated use session !== 'closed' */
  is_live?: boolean
  /** Unix ms when price was last set */
  as_of?: number | null
}

export interface WatchlistStockWithSnapshot extends WatchlistStock {
  snapshot: StockSnapshot | null
}

export interface PortfolioHolding {
  id: string
  user_id: string
  ticker: string
  company_name: string | null
  quantity: number
  avg_cost_basis: number
  broker: string | null
  synced_at: string
}

export interface PortfolioHoldingWithPrice extends PortfolioHolding {
  snapshot: StockSnapshot | null
}

// ── Portfolio holding signals (inline on holding cards) ───────────────────────
export type HoldingSignalTier = 'quiet' | 'soft' | 'attention' | 'profit'

export interface HoldingSignal {
  tier: HoldingSignalTier
  /** Bearish score when tier is soft or attention. */
  score?: number
  headline: string
  factors: PickFactor[]
  review_reason: string | null
  caveat: string | null
  narrative_source: 'llm' | 'mechanical'
}

export interface PortfolioHoldingWithSignal extends PortfolioHoldingWithPrice {
  signal: HoldingSignal
}

export interface PortfolioSignalsMeta {
  by_tier: { soft: number; attention: number; profit: number }
  quiet_count: number
  holding_count: number
  llm_enabled: boolean
  generated_at: string
}

export interface PortfolioWithSignalsResponse {
  holdings: PortfolioHoldingWithSignal[]
  meta: PortfolioSignalsMeta
}

// ── Portfolio daily briefing ───────────────────────────────────────────────────
export type PortfolioSummarySentiment = 'positive' | 'neutral' | 'negative'

export type PortfolioSummaryTag =
  | 'earnings_beat'
  | 'earnings_miss'
  | 'earnings_soon'
  | 'target_raised'
  | 'target_cut'
  | 'weak_guidance'
  | 'strong_momentum'
  | 'weak_momentum'
  | 'analyst_upgrade'
  | 'analyst_downgrade'
  | 'heavy_sell_ratings'
  | 'strong_buy_ratings'
  | 'negative_news'
  | 'positive_news'
  | 'near_52w_high'
  | 'near_52w_low'
  | 'profit_target_reached'

export interface HoldingDailySummary {
  ticker: string
  company_name: string | null
  sentiment: PortfolioSummarySentiment
  tags: PortfolioSummaryTag[]
  summary: string
  headline?: string
  degraded_input?: boolean
}

export interface PortfolioDailySummaryPayload {
  version: 1
  generated_at: string
  holdings_hash: string
  market_session: MarketSession
  portfolio_headline: string
  portfolio_sentiment: PortfolioSummarySentiment
  holdings: HoldingDailySummary[]
  degraded_tickers: string[]
  inputs_as_of: {
    prices_at: string | null
    fundamentals_age_min: string | null
    fundamentals_age_max: string | null
    research_age_min: string | null
    research_age_max: string | null
  }
  narrative_source: 'llm' | 'mechanical'
  model?: string | null
}

export interface PortfolioSummaryResponse {
  summary: PortfolioDailySummaryPayload | null
  stale: boolean
  refreshing: boolean
  llm_enabled: boolean
}

export interface StockFundamentals {
  ticker: string
  // Historical % changes
  change_7d_pct: number | null
  change_14d_pct: number | null
  change_30d_pct: number | null
  // 52-week range
  week52_high: number | null
  week52_low: number | null
  // Analyst consensus (raw from FMP / Finnhub / Yahoo)
  target_mean: number | null
  target_high: number | null
  target_low: number | null
  // Resolved target price — shared cache, refreshed after 5pm IST daily
  target_price: number | null
  target_source: 'stockanalysis' | 'fmp' | 'eulerpool' | 'finnhub' | 'yahoo' | '52w_high' | null
  target_fetched_at: string | null
  analyst_buy: number | null
  analyst_hold: number | null
  analyst_sell: number | null
  // News sentiment (Finnhub)
  news_sentiment: number | null
  news_count_7d: number | null
  // Short-term support / trend (computed from Yahoo 1y candles)
  support_5d: number | null
  support_20d: number | null
  avg_20d: number | null
  /** Today volume ÷ 20-day average (Yahoo daily candles). */
  volume_ratio: number | null
}

/** On-demand Yahoo quoteSummary — earnings, valuation, financial health (not in stock_fundamentals). */
export interface StockResearchSnapshot {
  ticker: string
  earnings_date: string | null
  ex_dividend_date: string | null
  pe_trailing: number | null
  pe_forward: number | null
  market_cap: number | null
  beta: number | null
  dividend_yield_pct: number | null
  revenue_growth_pct: number | null
  earnings_growth_pct: number | null
  gross_margin_pct: number | null
  operating_margin_pct: number | null
  profit_margin_pct: number | null
  debt_to_equity: number | null
  current_ratio: number | null
}

// ── Sector benchmarks (shared ETF proxies, 30 min cache) ─────────────────────
export interface SectorBenchmark {
  sector: string
  benchmark_ticker: string
  change_1d_pct: number | null
  change_7d_pct: number | null
  change_14d_pct: number | null
  change_30d_pct: number | null
  fetched_at: string
}

export interface VsSectorWindow {
  stock: number
  sector: number
  delta: number
}

export interface SectorRelativeStrength {
  ticker: string
  sector: string
  sector_source: 'watchlist' | 'resolved' | 'fallback'
  benchmark_ticker: string | null
  badge: 'leader' | 'inline' | 'lagger' | null
  rs_score: number | null
  /** 7d/14d/30d only — d1 computed client-side with regular-session quotes. */
  windows: {
    d7: VsSectorWindow | null
    d14: VsSectorWindow | null
    d30: VsSectorWindow | null
  } | null
  benchmark_fetched_at: string | null
}

export interface FundamentalsBatchResponse {
  fundamentals: Record<string, StockFundamentals>
  vs_sector: Record<string, SectorRelativeStrength>
  sector_benchmarks: Record<string, SectorBenchmark>
  /** Regular-session day % per ticker — for client d1 vs sector (not extended hours). */
  regular_change_1d_pct: Record<string, number>
  sector_benchmarks_refreshing: boolean
  sector_benchmarks_age_minutes: number | null
  refreshing: boolean
}

// ── Signals (computed server-side, consumed by News page) ────────────────────
export interface SignalReason {
  label: string
  tone: 'bullish' | 'bearish' | 'neutral'
}

export interface SignalNewsItem {
  title: string
  url: string
  source: string
  published_at: string
  sentiment: 'bullish' | 'bearish'
}

export interface Signal {
  ticker: string
  company_name: string
  sector: string | null
  price: number | null
  change_1d_pct: number | null
  score: number
  bias: 'bullish' | 'bearish' | 'quiet'
  reasons: SignalReason[]
  news: SignalNewsItem[]
}

export interface SignalsResponse {
  bullish: Signal[]
  bearish: Signal[]
  quiet: Signal[]
  generated_at: string
}

// ── Picks (buy recommendations) ──────────────────────────────────────────────
export type PickSourceTag = 'watchlist' | 'portfolio' | 'both' | 'discovery'

export interface PickFactor {
  label: string         // e.g. "Strong buy consensus"
  value?: string        // e.g. "22 of 26 analysts"
  tone: 'positive' | 'negative' | 'neutral'
}

export interface PickOwnership {
  shares: number
  avg_cost_basis: number
  current_value: number
}

export interface Pick {
  ticker: string
  company_name: string
  sector: string | null

  // Pricing
  current_price: number
  change_1d_pct: number | null
  change_1d_session?: MarketSession
  change_7d_pct: number | null
  change_14d_pct: number | null
  change_30d_pct: number | null
  volume_ratio: number | null
  news_count_7d: number | null
  entry_low: number          // short-term buy zone low
  entry_high: number         // short-term buy zone high
  target_mean: number
  target_low: number | null
  target_high: number | null
  upside_pct: number
  /** analyst = Finnhub mean; 52w_high = room to 52W high; momentum = consensus + trend */
  target_label: 'analyst' | '52w_high' | 'momentum'
  week52_high: number | null
  week52_low: number | null

  // Confidence / coverage
  analyst_total: number
  analyst_buy: number
  analyst_hold: number
  analyst_sell: number
  confidence: 'high' | 'medium' | 'low'

  // Reasoning
  score: number
  factors: PickFactor[]          // matched scoring factors
  vs_sector: SectorRelativeStrength | null
  source: PickSourceTag
  /** What the company sells / how it makes money (2–3 sentences). */
  company_blurb: string | null
  thesis: string | null          // LLM narrative (null if not generated)
  main_risk: string | null
  narrative_source: 'llm' | 'mechanical'
  /** ISO timestamp when thesis/risk was last generated (3h cache). */
  narrative_generated_at: string | null

  /** Up to 5 recent headlines (Google News RSS, 15 min in-memory cache). */
  news: SignalNewsItem[]

  // Optional ownership tag
  ownership: PickOwnership | null
}

export interface PicksResponse {
  /** Top 10 buy ideas ranked across watchlist, portfolio, and strong movers. */
  picks: Pick[]
  /** @deprecated subset of picks — non-discovery sources only */
  your_picks: Pick[]
  /** @deprecated subset of picks — discovery source only */
  discovery_picks: Pick[]
  /** When prices, scores, and ranking were last computed */
  scores_at: string
  /** When pick summaries were last generated (3h narrative cache) */
  narratives_at: string | null
  llm_enabled: boolean
  /** Sector ETF benchmarks for client-side d1 vs-sector rows. */
  sector_benchmarks: Record<string, SectorBenchmark>
}

export interface PickNarrativePayload {
  company_blurb: string | null
  thesis: string
  main_risk: string
  narrative_source: 'llm' | 'mechanical'
  narrative_generated_at: string
}

export interface PickNarrativesResponse {
  narratives: Record<string, PickNarrativePayload>
  llm_enabled: boolean
}

export interface PickHeadlinesResponse {
  headlines: Record<string, SignalNewsItem[]>
}

export interface VestedRow {
  name: string
  ticker: string
  shares: number
  avgCost: number
}

// ── Portfolio sell review alerts ─────────────────────────────────────────────
export interface PortfolioAlertHolding {
  quantity: number
  avg_cost_basis: number
  current_price: number
  position_pnl_pct: number
  position_value: number
  invested: number
}

export interface PortfolioAlert {
  ticker: string
  company_name: string | null
  severity: 'red' | 'watch'
  score: number
  headline: string
  holding: PortfolioAlertHolding
  factors: PickFactor[]
  review_reason: string | null
  caveat: string | null
  narrative_source: 'llm' | 'mechanical'
}

export interface PortfolioAlertsResponse {
  alerts: PortfolioAlert[]
  clear_count: number
  holding_count: number
  generated_at: string
  llm_enabled: boolean
}

// ── Watchlist add suggestions (market movers not on your list) ───────────────
export interface TrendingNarrative {
  company_blurb: string
  thesis: string
  main_risk: string
}

export interface WatchlistSuggestion {
  ticker: string
  company_name: string
  sector: string | null
  current_price: number
  change_1d_pct: number
  change_30d_pct: number | null
  upside_pct: number | null
  analyst_buy: number
  analyst_total: number
  score: number
  headline: string
  company_blurb: string | null
  thesis: string | null
  main_risk: string | null
  /** @deprecated Flat blurb — use company_blurb + thesis + main_risk */
  reason: string | null
  narrative_source: 'llm' | 'mechanical'
}

export interface WatchlistSuggestionsResponse {
  suggestions: WatchlistSuggestion[]
  generated_at: string
  llm_enabled: boolean
  /** How many tickers passed scoring in the global pool (before excluding your list). */
  scanned_count: number
}
