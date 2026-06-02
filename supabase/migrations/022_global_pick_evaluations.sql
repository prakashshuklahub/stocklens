-- Track Top Picks accuracy at fixed horizons (v1: 30 calendar days).

CREATE TABLE IF NOT EXISTS global_pick_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id uuid NOT NULL REFERENCES global_top_picks(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES global_top_picks_runs(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  ticker text NOT NULL,
  rank int NOT NULL,
  horizon_days int NOT NULL DEFAULT 30,

  evaluated_at timestamptz NOT NULL DEFAULT now(),

  price_at_publish numeric NOT NULL,
  target_at_publish numeric,
  upside_pct_at_publish numeric,
  entry_low_at_publish numeric,
  entry_high_at_publish numeric,

  price_at_eval numeric,
  return_pct numeric,
  spy_return_pct numeric,
  vs_spy_pct numeric,
  hit_target boolean NOT NULL DEFAULT false,
  is_correct boolean NOT NULL DEFAULT false,

  UNIQUE (pick_id, horizon_days)
);

CREATE INDEX IF NOT EXISTS global_pick_evaluations_run_horizon_idx
  ON global_pick_evaluations (run_id, horizon_days);

CREATE INDEX IF NOT EXISTS global_pick_evaluations_evaluated_at_idx
  ON global_pick_evaluations (evaluated_at DESC);

CREATE TABLE IF NOT EXISTS global_pick_accuracy_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES global_top_picks_runs(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  horizon_days int NOT NULL DEFAULT 30,
  total_picks int NOT NULL,
  correct_count int NOT NULL,
  beat_spy_count int NOT NULL DEFAULT 0,
  avg_return_pct numeric,
  report_json jsonb NOT NULL,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS global_pick_accuracy_reports_created_idx
  ON global_pick_accuracy_reports (created_at DESC);

ALTER TABLE global_pick_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_pick_accuracy_reports ENABLE ROW LEVEL SECURITY;
