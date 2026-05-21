-- Permanent shared cache for company logos (fetched once per ticker).
-- Written by API (service role); read by authenticated users.

CREATE TABLE IF NOT EXISTS stock_logos (
  ticker        text PRIMARY KEY,
  content_type  text NOT NULL DEFAULT 'image/png',
  logo_base64   text,
  status        text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'unavailable')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE stock_logos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stock_logos_select_auth" ON stock_logos;
CREATE POLICY "stock_logos_select_auth" ON stock_logos
  FOR SELECT TO authenticated USING (true);
