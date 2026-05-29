-- User-defined tags on watchlist stocks (multi-tag, freeform names).

CREATE TABLE IF NOT EXISTS watchlist_tags (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             text NOT NULL,
  name_normalized  text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name_normalized)
);

CREATE INDEX IF NOT EXISTS watchlist_tags_user_idx
  ON watchlist_tags (user_id);

CREATE TABLE IF NOT EXISTS watchlist_stock_tags (
  watchlist_stock_id uuid NOT NULL REFERENCES watchlist_stocks(id) ON DELETE CASCADE,
  tag_id             uuid NOT NULL REFERENCES watchlist_tags(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (watchlist_stock_id, tag_id)
);

CREATE INDEX IF NOT EXISTS watchlist_stock_tags_stock_idx
  ON watchlist_stock_tags (watchlist_stock_id);

CREATE INDEX IF NOT EXISTS watchlist_stock_tags_tag_idx
  ON watchlist_stock_tags (tag_id);

CREATE INDEX IF NOT EXISTS watchlist_stock_tags_user_idx
  ON watchlist_stock_tags (user_id);

ALTER TABLE watchlist_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_stock_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watchlist_tags_select_own" ON watchlist_tags;
CREATE POLICY "watchlist_tags_select_own" ON watchlist_tags
  FOR SELECT USING (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "watchlist_tags_insert_own" ON watchlist_tags;
CREATE POLICY "watchlist_tags_insert_own" ON watchlist_tags
  FOR INSERT WITH CHECK (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "watchlist_tags_update_own" ON watchlist_tags;
CREATE POLICY "watchlist_tags_update_own" ON watchlist_tags
  FOR UPDATE USING (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "watchlist_tags_delete_own" ON watchlist_tags;
CREATE POLICY "watchlist_tags_delete_own" ON watchlist_tags
  FOR DELETE USING (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "watchlist_stock_tags_select_own" ON watchlist_stock_tags;
CREATE POLICY "watchlist_stock_tags_select_own" ON watchlist_stock_tags
  FOR SELECT USING (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "watchlist_stock_tags_insert_own" ON watchlist_stock_tags;
CREATE POLICY "watchlist_stock_tags_insert_own" ON watchlist_stock_tags
  FOR INSERT WITH CHECK (user_id::text = auth.uid()::text);

DROP POLICY IF EXISTS "watchlist_stock_tags_delete_own" ON watchlist_stock_tags;
CREATE POLICY "watchlist_stock_tags_delete_own" ON watchlist_stock_tags
  FOR DELETE USING (user_id::text = auth.uid()::text);
