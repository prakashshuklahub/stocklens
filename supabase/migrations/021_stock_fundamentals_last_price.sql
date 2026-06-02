-- Cached last price for DB-only global picks cron (no live Yahoo on cron path).

ALTER TABLE stock_fundamentals
  ADD COLUMN IF NOT EXISTS last_price numeric(12,4),
  ADD COLUMN IF NOT EXISTS change_1d_pct numeric(8,4);
