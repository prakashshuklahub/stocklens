-- ── Picks feature ─────────────────────────────────────────────────────────────
-- Adds:
--   1. Short-term support / moving-average columns to stock_fundamentals
--      (computed once from the 1-year Yahoo candle response, cached for 30 min)
--   2. pick_narratives table — caches LLM-generated thesis + risk per ticker
--      for ~6 hours to avoid repeat token spend.

-- ── 1. support levels on stock_fundamentals ───────────────────────────────────
ALTER TABLE stock_fundamentals
  ADD COLUMN IF NOT EXISTS support_5d   numeric(12,4),
  ADD COLUMN IF NOT EXISTS support_20d  numeric(12,4),
  ADD COLUMN IF NOT EXISTS avg_20d      numeric(12,4);

-- ── 2. pick_narratives (shared LLM cache) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS pick_narratives (
  ticker        text PRIMARY KEY,
  thesis        text NOT NULL,
  main_risk     text NOT NULL,
  model         text,
  generated_at  timestamptz DEFAULT now()
);

ALTER TABLE pick_narratives ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (narratives are not user-specific)
CREATE POLICY "pick_narratives_select_auth" ON pick_narratives
  FOR SELECT TO authenticated USING (true);

-- Index for fast cache-freshness checks
CREATE INDEX IF NOT EXISTS pick_narratives_generated_idx
  ON pick_narratives (ticker, generated_at DESC);
