-- =====================
-- watchlist_suggestions
-- Daily AI-generated stock suggestions (trending + quality)
-- =====================
CREATE TABLE IF NOT EXISTS watchlist_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  company_name text,
  sector text,
  current_price numeric(12,4),
  market_cap_billions numeric(12,2),
  reason text,         -- AI-written one-liner: why this stock deserves attention
  score integer CHECK (score BETWEEN 1 AND 10),
  source text,         -- 'trending', 'fundamental_quality', 'news_momentum'
  generated_date date DEFAULT CURRENT_DATE,
  UNIQUE(ticker, generated_date)
);

ALTER TABLE watchlist_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "suggestions_select_auth" ON watchlist_suggestions
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS suggestions_date_idx ON watchlist_suggestions(generated_date DESC);

-- =====================
-- peak_review_flags
-- Per-user flags: "this watchlist stock may have peaked"
-- =====================
CREATE TABLE IF NOT EXISTS peak_review_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  flag_type text NOT NULL, -- 'overvalued', 'growth_declining', 'thesis_complete', 'analyst_consensus_reached'
  reason text,             -- AI analysis: why it may have peaked
  pe_vs_sector text,       -- e.g. "2.1x sector median"
  dismissed boolean DEFAULT false,
  flagged_at timestamptz DEFAULT now(),
  UNIQUE(user_id, ticker, flagged_at::date)
);

ALTER TABLE peak_review_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "peak_select_own" ON peak_review_flags
  FOR SELECT USING (user_id::text = auth.uid()::text);

CREATE POLICY "peak_update_own" ON peak_review_flags
  FOR UPDATE USING (user_id::text = auth.uid()::text);

CREATE INDEX IF NOT EXISTS peak_user_ticker_idx ON peak_review_flags(user_id, flagged_at DESC);
