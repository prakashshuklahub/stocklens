-- Shared cache table for stock fundamentals (common across all users)
-- Source of truth: Yahoo Finance (7d/14d/30d, 52W) + Finnhub (analyst, target)
-- Refreshed by API route when data is older than 30 minutes

CREATE TABLE IF NOT EXISTS stock_fundamentals (
  ticker          text PRIMARY KEY,
  change_7d_pct   numeric(8,4),
  change_14d_pct  numeric(8,4),
  change_30d_pct  numeric(8,4),
  week52_high     numeric(12,4),
  week52_low      numeric(12,4),
  target_mean     numeric(12,4),
  target_high     numeric(12,4),
  target_low      numeric(12,4),
  analyst_buy     integer,
  analyst_hold    integer,
  analyst_sell    integer,
  fetched_at      timestamptz DEFAULT now()
);

ALTER TABLE stock_fundamentals ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (shared data)
CREATE POLICY "stock_fundamentals_select_auth" ON stock_fundamentals
  FOR SELECT TO authenticated USING (true);

-- Index for fast cache-freshness checks
CREATE INDEX IF NOT EXISTS stock_fundamentals_fetched_idx
  ON stock_fundamentals (ticker, fetched_at DESC);
