-- Global Top Picks — one shared ranked list per trading day (cron-built, DB-only scoring).

CREATE TABLE IF NOT EXISTS global_top_picks_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date date NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  published boolean NOT NULL DEFAULT false,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  universe_count int,
  qualified_count int,
  min_score_used numeric,
  config jsonb,
  error_message text
);

CREATE UNIQUE INDEX IF NOT EXISTS global_top_picks_runs_run_date_completed_idx
  ON global_top_picks_runs (run_date)
  WHERE status = 'completed';

CREATE INDEX IF NOT EXISTS global_top_picks_runs_published_date_idx
  ON global_top_picks_runs (run_date DESC)
  WHERE published = true;

CREATE TABLE IF NOT EXISTS global_top_picks (
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

CREATE INDEX IF NOT EXISTS global_top_picks_run_rank_idx
  ON global_top_picks (run_id, rank);

ALTER TABLE global_top_picks_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_top_picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "global_top_picks_runs_select_auth" ON global_top_picks_runs;
CREATE POLICY "global_top_picks_runs_select_auth" ON global_top_picks_runs
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "global_top_picks_select_auth" ON global_top_picks;
CREATE POLICY "global_top_picks_select_auth" ON global_top_picks
  FOR SELECT TO authenticated USING (true);
