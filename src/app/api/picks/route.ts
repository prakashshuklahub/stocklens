import { auth, getSessionUserId } from '@/lib/auth'
import { refreshFundamentalsForTickers } from '@/lib/load-fundamentals'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { buildUnifiedPicksResponse, PICKS_NO_CACHE_HEADERS } from '@/lib/picks-pipeline'
import { rebuildTrendingCacheIfNeeded } from '@/lib/trending-cache-schedule'
import { createServerClient } from '@/lib/supabase'
import { after, NextRequest, NextResponse } from 'next/server'

/** Top 10 buy ideas ranked across watchlist, portfolio, and strong movers. */
export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1' && isPriceRefreshActive()
  const supabase = createServerClient()
  const { response, staleFundamentals } = await buildUnifiedPicksResponse(supabase, userId, forceRefresh)

  after(async () => {
    await rebuildTrendingCacheIfNeeded(supabase)
    if (staleFundamentals.length) {
      console.info(
        `[picks] background fundamentals refresh for ${staleFundamentals.length} tickers`,
      )
      await refreshFundamentalsForTickers(supabase, staleFundamentals)
    }
  })

  return NextResponse.json(response, { headers: PICKS_NO_CACHE_HEADERS })
}
