-- Add Eulerpool as analyst target source; force re-fetch of 52W-only cached rows.

ALTER TABLE stock_fundamentals DROP CONSTRAINT IF EXISTS stock_fundamentals_target_source_check;
ALTER TABLE stock_fundamentals ADD CONSTRAINT stock_fundamentals_target_source_check
  CHECK (target_source IN ('fmp', 'eulerpool', 'finnhub', 'yahoo', '52w_high'));

-- Invalidate 52W fallback rows so FMP → Eulerpool chain runs on next load
UPDATE stock_fundamentals
SET target_fetched_at = NULL
WHERE target_source = '52w_high';
