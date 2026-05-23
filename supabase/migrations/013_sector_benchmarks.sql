-- Shared sector ETF benchmarks for "performance vs sector" (11 sectors, 30 min TTL in API).

CREATE TABLE IF NOT EXISTS sector_benchmarks (
  sector              text PRIMARY KEY,
  benchmark_ticker    text NOT NULL,
  change_1d_pct       numeric(8,4),
  change_7d_pct       numeric(8,4),
  change_14d_pct      numeric(8,4),
  change_30d_pct      numeric(8,4),
  fetched_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sector_benchmarks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sector_benchmarks_read" ON sector_benchmarks;
CREATE POLICY "sector_benchmarks_read" ON sector_benchmarks
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS sector_benchmarks_fetched_idx
  ON sector_benchmarks (fetched_at DESC);

-- Single-row refresh lock — prevents duplicate 11-ETF Yahoo bursts when cache is stale.
CREATE TABLE IF NOT EXISTS sector_benchmarks_lock (
  id              smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  refreshing      boolean NOT NULL DEFAULT false,
  locked_until    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE sector_benchmarks_lock ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sector_benchmarks_lock_read" ON sector_benchmarks_lock;
CREATE POLICY "sector_benchmarks_lock_read" ON sector_benchmarks_lock
  FOR SELECT TO authenticated USING (true);

INSERT INTO sector_benchmarks_lock (id, refreshing, locked_until)
VALUES (1, false, now())
ON CONFLICT (id) DO NOTHING;
