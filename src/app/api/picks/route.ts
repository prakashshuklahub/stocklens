import { auth, getSessionUserId } from '@/lib/auth'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { buildUnifiedPicksResponse, PICKS_NO_CACHE_HEADERS } from '@/lib/picks-pipeline'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

/** Top 10 buy ideas ranked across watchlist, portfolio, and strong movers. */
export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1' && isPriceRefreshActive()
  const supabase = createServerClient()
  const response = await buildUnifiedPicksResponse(supabase, userId, forceRefresh)

  return NextResponse.json(response, { headers: PICKS_NO_CACHE_HEADERS })
}
