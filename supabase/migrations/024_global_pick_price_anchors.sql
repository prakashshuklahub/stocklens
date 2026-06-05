-- Permanent suggested-price anchors — locked from first time a ticker appears on picks.

CREATE TABLE IF NOT EXISTS global_pick_price_anchors (
  ticker text PRIMARY KEY,
  suggested_price numeric(12, 4) NOT NULL,
  entry_low numeric(12, 4) NOT NULL,
  entry_high numeric(12, 4) NOT NULL,
  suggested_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE global_pick_price_anchors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "global_pick_price_anchors_select_auth" ON global_pick_price_anchors;
CREATE POLICY "global_pick_price_anchors_select_auth" ON global_pick_price_anchors
  FOR SELECT TO authenticated USING (true);

-- Backfill earliest published snapshot per ticker (top + risky buckets).
WITH all_picks AS (
  SELECT
    upper(gp.ticker) AS ticker,
    gp.snapshot,
    gr.completed_at,
    gr.run_date
  FROM global_top_picks gp
  JOIN global_top_picks_runs gr ON gr.id = gp.run_id AND gr.published = true
  UNION ALL
  SELECT
    upper(gp.ticker) AS ticker,
    gp.snapshot,
    gr.completed_at,
    gr.run_date
  FROM global_top_picks_risky gp
  JOIN global_top_picks_runs gr ON gr.id = gp.run_id AND gr.published = true
),
earliest AS (
  SELECT DISTINCT ON (ticker)
    ticker,
    snapshot,
    completed_at
  FROM all_picks
  ORDER BY ticker, run_date ASC
)
INSERT INTO global_pick_price_anchors (ticker, suggested_price, entry_low, entry_high, suggested_at)
SELECT
  e.ticker,
  coalesce(
    nullif((e.snapshot->>'suggested_price')::numeric, 0),
    nullif((e.snapshot->>'entry_high')::numeric, 0),
    nullif((e.snapshot->>'current_price')::numeric, 0)
  ) AS suggested_price,
  (e.snapshot->>'entry_low')::numeric AS entry_low,
  (e.snapshot->>'entry_high')::numeric AS entry_high,
  coalesce(
    nullif(e.snapshot->>'suggested_at', '')::timestamptz,
    e.completed_at
  ) AS suggested_at
FROM earliest e
WHERE coalesce(
  nullif((e.snapshot->>'suggested_price')::numeric, 0),
  nullif((e.snapshot->>'entry_high')::numeric, 0),
  nullif((e.snapshot->>'current_price')::numeric, 0)
) IS NOT NULL
ON CONFLICT (ticker) DO NOTHING;
