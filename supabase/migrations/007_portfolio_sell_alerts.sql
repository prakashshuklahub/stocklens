-- Portfolio sell-review narratives (shared cache, like pick_narratives).
-- Scoring runs per-request from holdings + stock_fundamentals; this table only caches LLM copy.

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
