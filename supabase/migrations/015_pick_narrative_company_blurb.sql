-- Company context blurb for pick narratives (what they sell, customers, revenue model).
ALTER TABLE pick_narratives
  ADD COLUMN IF NOT EXISTS company_blurb text;
