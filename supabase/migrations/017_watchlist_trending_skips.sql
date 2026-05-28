-- Per-user skip on watchlist Trending cards (hidden for 24 hours).

CREATE TABLE IF NOT EXISTS watchlist_trending_skips (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ticker     text NOT NULL,
  skipped_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ticker)
);

CREATE INDEX IF NOT EXISTS watchlist_trending_skips_user_idx
  ON watchlist_trending_skips (user_id, skipped_at DESC);

ALTER TABLE watchlist_trending_skips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "trending_skips_select_own" ON watchlist_trending_skips;
CREATE POLICY "trending_skips_select_own" ON watchlist_trending_skips
  FOR SELECT USING (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "trending_skips_insert_own" ON watchlist_trending_skips;
CREATE POLICY "trending_skips_insert_own" ON watchlist_trending_skips
  FOR INSERT WITH CHECK (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "trending_skips_update_own" ON watchlist_trending_skips;
CREATE POLICY "trending_skips_update_own" ON watchlist_trending_skips
  FOR UPDATE USING (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "trending_skips_delete_own" ON watchlist_trending_skips;
CREATE POLICY "trending_skips_delete_own" ON watchlist_trending_skips
  FOR DELETE USING (user_id::text = auth.uid()::text);
