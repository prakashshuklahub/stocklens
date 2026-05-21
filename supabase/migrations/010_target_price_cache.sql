-- Resolved target price cache (shared across all users).
-- Refreshed after 5pm ET daily; analyst data from FMP/Finnhub/Yahoo, else 52-week high.

ALTER TABLE stock_fundamentals
  ADD COLUMN IF NOT EXISTS target_price      numeric(12,4),
  ADD COLUMN IF NOT EXISTS target_source     text CHECK (target_source IN ('fmp', 'finnhub', 'yahoo', '52w_high')),
  ADD COLUMN IF NOT EXISTS target_fetched_at timestamptz;

-- Backfill from existing analyst / 52W data where possible
UPDATE stock_fundamentals
SET
  target_price = CASE
    WHEN target_mean IS NOT NULL AND target_mean > 0 THEN target_mean
    WHEN week52_high IS NOT NULL AND week52_high > 0 THEN week52_high
    ELSE NULL
  END,
  target_source = CASE
    WHEN target_mean IS NOT NULL AND target_mean > 0 THEN 'yahoo'
    WHEN week52_high IS NOT NULL AND week52_high > 0 THEN '52w_high'
    ELSE NULL
  END,
  target_fetched_at = fetched_at
WHERE target_fetched_at IS NULL AND (
  (target_mean IS NOT NULL AND target_mean > 0)
  OR (week52_high IS NOT NULL AND week52_high > 0)
);
