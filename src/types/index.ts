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
export interface PickVsSector {
  benchmark_ticker: string | null
  badge: 'leader' | 'inline' | 'lagger' | null
  rs_score: number | null
  /** Stock minus sector ETF on 7d window (percentage points). */
  delta_7d: number | null
  delta_30d: number | null
}

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
  vs_sector: PickVsSector | null
  source: PickSourceTag
  thesis: string | null          // LLM narrative (null if not generated)
  main_risk: string | null
  narrative_source: 'llm' | 'mechanical'
  /** ISO timestamp when thesis/risk was last generated (3h cache). */
  narrative_generated_at: string | null

  // Optional ownership tag
  ownership: PickOwnership | null
}

export interface PicksResponse {
  /** Top buy ideas from your watchlist and portfolio (max 5). */
  your_picks: Pick[]
  /** Strong market movers you are not tracking yet (max 5). */
  discovery_picks: Pick[]
  /** @deprecated use your_picks + discovery_picks */
  picks: Pick[]
  /** When prices, scores, and ranking were last computed */
  scores_at: string
  /** When pick summaries were last generated (3h narrative cache) */
  narratives_at: string | null
  llm_enabled: boolean
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
