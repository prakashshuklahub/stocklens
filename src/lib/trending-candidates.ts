/**
 * Where trending card candidates come from.
 *
 * • Source: Yahoo market screens (day gainers + most active) — not the user's watchlist.
 * • Watchlist exclusion happens only in GET /api/watchlist/suggestions after scoring.
 */

import { fetchMarketMovers, type MoverQuote } from '@/lib/market-movers'

export type { MoverQuote }

/** Pull the candidate pool for trending scoring (default up to 100 unique tickers). */
export async function fetchTrendingCandidates(limit = 30): Promise<MoverQuote[]> {
  return fetchMarketMovers(limit)
}
