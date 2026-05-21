-- Run once in Supabase SQL Editor (idempotent).
-- Creates stock_fundamentals + pick_narratives used by watchlist, signals, and picks.

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

ALTER TABLE stock_fundamentals
  ADD COLUMN IF NOT EXISTS news_sentiment  numeric(6,4),
  ADD COLUMN IF NOT EXISTS news_count_7d   integer,
  ADD COLUMN IF NOT EXISTS support_5d      numeric(12,4),
  ADD COLUMN IF NOT EXISTS support_20d     numeric(12,4),
  ADD COLUMN IF NOT EXISTS avg_20d         numeric(12,4);

ALTER TABLE stock_fundamentals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_fundamentals_select_auth" ON stock_fundamentals;
CREATE POLICY "stock_fundamentals_select_auth" ON stock_fundamentals
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS stock_fundamentals_fetched_idx
  ON stock_fundamentals (ticker, fetched_at DESC);

CREATE TABLE IF NOT EXISTS pick_narratives (
  ticker        text PRIMARY KEY,
  thesis        text NOT NULL,
  main_risk     text NOT NULL,
  model         text,
  generated_at  timestamptz DEFAULT now()
);

ALTER TABLE pick_narratives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pick_narratives_select_auth" ON pick_narratives;
CREATE POLICY "pick_narratives_select_auth" ON pick_narratives
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS pick_narratives_generated_idx
  ON pick_narratives (ticker, generated_at DESC);

-- Portfolio sell-review narrative cache (007)
CREATE TABLE IF NOT EXISTS portfolio_sell_narratives (
  ticker         text PRIMARY KEY,
  review_reason  text NOT NULL,
  caveat         text NOT NULL,
  model          text,
  generated_at   timestamptz DEFAULT now()
);

ALTER TABLE portfolio_sell_narratives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolio_sell_narratives_select_auth" ON portfolio_sell_narratives;
CREATE POLICY "portfolio_sell_narratives_select_auth" ON portfolio_sell_narratives
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS portfolio_sell_narratives_generated_idx
  ON portfolio_sell_narratives (ticker, generated_at DESC);

-- Watchlist trending suggestions cache (008)
CREATE TABLE IF NOT EXISTS watchlist_suggestions_cache (
  cache_key     text PRIMARY KEY DEFAULT 'global',
  suggestions   jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE watchlist_suggestions_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watchlist_suggestions_cache_select_auth" ON watchlist_suggestions_cache;
CREATE POLICY "watchlist_suggestions_cache_select_auth" ON watchlist_suggestions_cache
  FOR SELECT TO authenticated USING (true);

-- Service role needs write access for API upserts (bypasses RLS when using service key).

-- Permanent company logo cache (009)
CREATE TABLE IF NOT EXISTS stock_logos (
  ticker        text PRIMARY KEY,
  content_type  text NOT NULL DEFAULT 'image/png',
  logo_base64   text,
  status        text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'unavailable')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stock_logos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_logos_select_auth" ON stock_logos;
CREATE POLICY "stock_logos_select_auth" ON stock_logos
  FOR SELECT TO authenticated USING (true);
