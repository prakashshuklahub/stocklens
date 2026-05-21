-- Shared cache for "stocks to watch" suggestions (top momentum picks, 6h TTL in API).
-- Per-user filtering (exclude existing watchlist) happens at read time.

CREATE TABLE IF NOT EXISTS watchlist_suggestions_cache (
  cache_key     text PRIMARY KEY DEFAULT 'global',
  suggestions   jsonb NOT NULL DEFAULT '[]'::jsonb,
  generated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE watchlist_suggestions_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "watchlist_suggestions_cache_select_auth" ON watchlist_suggestions_cache;
CREATE POLICY "watchlist_suggestions_cache_select_auth" ON watchlist_suggestions_cache
  FOR SELECT TO authenticated USING (true);
