-- Add total_invested column to portfolio_holdings
ALTER TABLE portfolio_holdings
  ADD COLUMN IF NOT EXISTS total_invested numeric(12,4);

-- INSERT policy (per-user)
CREATE POLICY "portfolio_insert_own" ON portfolio_holdings
  FOR INSERT WITH CHECK (user_id::text = auth.uid()::text);

-- UPDATE policy (per-user)
CREATE POLICY "portfolio_update_own" ON portfolio_holdings
  FOR UPDATE USING (user_id::text = auth.uid()::text);

-- DELETE policy (per-user)
CREATE POLICY "portfolio_delete_own" ON portfolio_holdings
  FOR DELETE USING (user_id::text = auth.uid()::text);
