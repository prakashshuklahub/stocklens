-- Shared Yahoo research cache (earnings, valuation, financial health).
-- Refreshed slowly by /api/cron/refresh-research (~hourly); API reads DB only.

CREATE TABLE IF NOT EXISTS stock_research_cache (
  ticker                  text PRIMARY KEY,
  earnings_date           date,
  ex_dividend_date        date,
  pe_trailing             numeric(12,4),
  pe_forward              numeric(12,4),
  market_cap              numeric(16,2),
  beta                    numeric(8,4),
  dividend_yield_pct      numeric(8,4),
  revenue_growth_pct      numeric(8,4),
  earnings_growth_pct     numeric(8,4),
  gross_margin_pct        numeric(8,4),
  operating_margin_pct    numeric(8,4),
  profit_margin_pct       numeric(8,4),
  debt_to_equity          numeric(12,4),
  current_ratio           numeric(8,4),
  fetched_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stock_research_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_research_cache_select_auth" ON stock_research_cache;
CREATE POLICY "stock_research_cache_select_auth" ON stock_research_cache
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS stock_research_cache_fetched_idx
  ON stock_research_cache (fetched_at ASC);
