-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =====================
-- 1. users
-- =====================
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  is_admin boolean DEFAULT false,
  whatsapp_number text,
  fcm_token text,
  snaptrade_user_secret text,
  preferences jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own" ON users
  FOR SELECT USING (auth.uid()::text = id::text);

CREATE POLICY "users_update_own" ON users
  FOR UPDATE USING (auth.uid()::text = id::text);

-- =====================
-- 2. allowed_emails
-- =====================
CREATE TABLE IF NOT EXISTS allowed_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  added_by uuid REFERENCES users(id),
  added_at timestamptz DEFAULT now()
);

ALTER TABLE allowed_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allowed_emails_select_auth" ON allowed_emails
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "allowed_emails_insert_admin" ON allowed_emails
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM users WHERE id::text = auth.uid()::text AND is_admin = true)
  );

CREATE POLICY "allowed_emails_delete_admin" ON allowed_emails
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM users WHERE id::text = auth.uid()::text AND is_admin = true)
  );

-- =====================
-- 3. watchlist_stocks
-- =====================
CREATE TABLE IF NOT EXISTS watchlist_stocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  company_name text NOT NULL,
  sector text NOT NULL,
  conviction_score integer CHECK (conviction_score BETWEEN 1 AND 5),
  added_at timestamptz DEFAULT now(),
  notes text,
  UNIQUE(user_id, ticker)
);

ALTER TABLE watchlist_stocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "watchlist_select_own" ON watchlist_stocks
  FOR SELECT USING (user_id::text = auth.uid()::text);

CREATE POLICY "watchlist_insert_own" ON watchlist_stocks
  FOR INSERT WITH CHECK (
    user_id::text = auth.uid()::text AND
    (SELECT COUNT(*) FROM watchlist_stocks WHERE user_id::text = auth.uid()::text) < 30
  );

CREATE POLICY "watchlist_update_own" ON watchlist_stocks
  FOR UPDATE USING (user_id::text = auth.uid()::text);

CREATE POLICY "watchlist_delete_own" ON watchlist_stocks
  FOR DELETE USING (user_id::text = auth.uid()::text);

CREATE INDEX IF NOT EXISTS watchlist_user_idx ON watchlist_stocks(user_id);

-- =====================
-- 4. stock_snapshots
-- =====================
CREATE TABLE IF NOT EXISTS stock_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  price numeric(12,4),
  change_1d_pct numeric(8,4),
  change_5d_pct numeric(8,4),
  rsi_14 numeric(8,4),
  volume_ratio numeric(8,4),
  market_cap_billions numeric(12,2),
  high_52w numeric(12,4),
  fetched_at timestamptz DEFAULT now()
);

ALTER TABLE stock_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "snapshots_select_auth" ON stock_snapshots
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS snapshots_ticker_fetched_idx ON stock_snapshots(ticker, fetched_at DESC);

-- =====================
-- 5. fundamentals
-- =====================
CREATE TABLE IF NOT EXISTS fundamentals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text UNIQUE NOT NULL,
  pe_ratio numeric(10,2),
  forward_pe numeric(10,2),
  ps_ratio numeric(10,2),
  revenue_growth_yoy numeric(8,4),
  revenue_growth_qoq numeric(8,4),
  gross_margin numeric(8,4),
  net_margin numeric(8,4),
  debt_equity_ratio numeric(10,4),
  eps_trend jsonb,
  sector_pe_median numeric(10,2),
  analyst_target_price numeric(12,4),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE fundamentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fundamentals_select_auth" ON fundamentals
  FOR SELECT TO authenticated USING (true);

-- =====================
-- 6. news_articles
-- =====================
CREATE TABLE IF NOT EXISTS news_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  headline text NOT NULL,
  source text,
  url text,
  raw_description text,
  ai_summary text,
  sentiment_tag text CHECK (sentiment_tag IN ('bullish','bearish','risk','opportunity','neutral')),
  importance_score integer CHECK (importance_score BETWEEN 0 AND 5),
  is_duplicate boolean DEFAULT false,
  published_at timestamptz,
  processed_at timestamptz DEFAULT now()
);

ALTER TABLE news_articles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "news_select_auth" ON news_articles
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS news_ticker_published_idx ON news_articles(ticker, published_at DESC);
CREATE INDEX IF NOT EXISTS news_importance_published_idx ON news_articles(importance_score, published_at DESC);

-- =====================
-- 7. buy_signals
-- =====================
CREATE TABLE IF NOT EXISTS buy_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  trigger_type text NOT NULL,
  quant_flags jsonb,
  confidence_score integer CHECK (confidence_score BETWEEN 1 AND 10),
  buy_range_low numeric(12,4),
  buy_range_high numeric(12,4),
  ai_reason text,
  key_risk text,
  risk_level text CHECK (risk_level IN ('low','medium','high')),
  is_active boolean DEFAULT true,
  is_notified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  expires_at timestamptz
);

ALTER TABLE buy_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "signals_select_auth" ON buy_signals
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS signals_ticker_created_idx ON buy_signals(ticker, created_at DESC);

-- =====================
-- 8. sell_alerts
-- =====================
CREATE TABLE IF NOT EXISTS sell_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  ticker text NOT NULL,
  trigger_reason text NOT NULL,
  ai_analysis text,
  severity text CHECK (severity IN ('watch','warning','critical')),
  quant_data jsonb,
  is_sent boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE sell_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sell_alerts_select_own" ON sell_alerts
  FOR SELECT USING (user_id::text = auth.uid()::text);

CREATE INDEX IF NOT EXISTS sell_alerts_user_idx ON sell_alerts(user_id, created_at DESC);

-- =====================
-- 9. portfolio_holdings
-- =====================
CREATE TABLE IF NOT EXISTS portfolio_holdings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  ticker text NOT NULL,
  company_name text,
  quantity numeric(18,6),
  avg_cost_basis numeric(12,4),
  broker text,
  account_id text,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, ticker, broker)
);

ALTER TABLE portfolio_holdings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "portfolio_select_own" ON portfolio_holdings
  FOR SELECT USING (user_id::text = auth.uid()::text);

CREATE INDEX IF NOT EXISTS portfolio_user_idx ON portfolio_holdings(user_id);

-- =====================
-- 10. notifications_log
-- =====================
CREATE TABLE IF NOT EXISTS notifications_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  type text NOT NULL,
  channel text CHECK (channel IN ('push','whatsapp')),
  reference_id uuid,
  message text,
  sent_at timestamptz DEFAULT now(),
  delivered boolean DEFAULT false
);

ALTER TABLE notifications_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notif_select_own" ON notifications_log
  FOR SELECT USING (user_id::text = auth.uid()::text);

CREATE INDEX IF NOT EXISTS notif_user_sent_idx ON notifications_log(user_id, sent_at DESC);

-- =====================
-- 11. quant_candidates
-- =====================
CREATE TABLE IF NOT EXISTS quant_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  flags jsonb,
  flagged_at timestamptz DEFAULT now()
);

-- =====================
-- 12. conviction_drift_flags
-- =====================
CREATE TABLE IF NOT EXISTS conviction_drift_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker text NOT NULL,
  flag_type text NOT NULL,
  old_value numeric,
  new_value numeric,
  flagged_at timestamptz DEFAULT now()
);

ALTER TABLE conviction_drift_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "drift_select_auth" ON conviction_drift_flags
  FOR SELECT TO authenticated USING (true);
