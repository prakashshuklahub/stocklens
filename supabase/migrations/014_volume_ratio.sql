-- Volume vs 20-day average — computed from existing Yahoo 1y chart fetch (no new API).

ALTER TABLE stock_fundamentals
  ADD COLUMN IF NOT EXISTS volume_ratio numeric(8,4);
