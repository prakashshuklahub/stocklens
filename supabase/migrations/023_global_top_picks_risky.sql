-- Secondary global picks bucket ("riskier ideas") — same shape as global_top_picks.

CREATE TABLE IF NOT EXISTS global_top_picks_risky (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES global_top_picks_runs(id) ON DELETE CASCADE,
  rank int NOT NULL,
  ticker text NOT NULL,
  score numeric NOT NULL,
  confidence text NOT NULL,
  snapshot jsonb NOT NULL,
  UNIQUE (run_id, ticker),
  UNIQUE (run_id, rank)
);

CREATE INDEX IF NOT EXISTS global_top_picks_risky_run_rank_idx
  ON global_top_picks_risky (run_id, rank);

ALTER TABLE global_top_picks_risky ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "global_top_picks_risky_select_auth" ON global_top_picks_risky;
CREATE POLICY "global_top_picks_risky_select_auth" ON global_top_picks_risky
  FOR SELECT TO authenticated USING (true);

