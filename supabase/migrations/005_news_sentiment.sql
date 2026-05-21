-- Add Finnhub news sentiment to the shared stock_fundamentals cache
-- Source: Finnhub /news-sentiment endpoint
-- news_sentiment is companyNewsScore (range roughly -1 to +1; >0 = bullish)
-- news_count_7d is the number of articles Finnhub aggregated over the last week

ALTER TABLE stock_fundamentals
  ADD COLUMN IF NOT EXISTS news_sentiment  numeric(6,4),
  ADD COLUMN IF NOT EXISTS news_count_7d   integer;
