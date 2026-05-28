-- Per-user portfolio daily briefing (3h TTL, JSON payload).

CREATE TABLE IF NOT EXISTS portfolio_daily_summaries (
  user_id               uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  payload               jsonb NOT NULL,
  holdings_hash         text NOT NULL,
  generated_at          timestamptz NOT NULL DEFAULT now(),
  narrative_source      text NOT NULL CHECK (narrative_source IN ('llm', 'mechanical')),
  model                 text,
  is_regenerating       boolean NOT NULL DEFAULT false,
  regenerate_started_at timestamptz
);

ALTER TABLE portfolio_daily_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "portfolio_daily_summaries_select_own" ON portfolio_daily_summaries;
CREATE POLICY "portfolio_daily_summaries_select_own"
  ON portfolio_daily_summaries FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE INDEX IF NOT EXISTS portfolio_daily_summaries_generated_idx
  ON portfolio_daily_summaries (generated_at DESC);
