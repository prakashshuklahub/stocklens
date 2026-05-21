-- StockAnalysis.com as primary analyst target source (scraped consensus).

ALTER TABLE stock_fundamentals DROP CONSTRAINT IF EXISTS stock_fundamentals_target_source_check;
ALTER TABLE stock_fundamentals ADD CONSTRAINT stock_fundamentals_target_source_check
  CHECK (target_source IN ('stockanalysis', 'fmp', 'eulerpool', 'finnhub', 'yahoo', '52w_high'));

-- Re-fetch on next load / cron so StockAnalysis runs before FMP/Eulerpool chain.
UPDATE stock_fundamentals
SET target_fetched_at = NULL
WHERE target_source IS DISTINCT FROM 'stockanalysis';
