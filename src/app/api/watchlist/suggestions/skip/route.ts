import { auth, getSessionUserId } from '@/lib/auth'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { recordTrendingSkip } from '@/lib/trending-skips'
import { createServerClient } from '@/lib/supabase'
import { buildWatchlistSuggestionsResponse } from '@/app/api/watchlist/suggestions/route'
import { NextRequest, NextResponse } from 'next/server'

const NO_CACHE = { 'Cache-Control': 'private, no-store, max-age=0' } as const

/** Skip a trending card for 24 hours and return the updated suggestion list. */
export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  let body: { ticker?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const ticker = body.ticker?.trim()
  if (!ticker) {
    return NextResponse.json({ error: 'ticker is required' }, { status: 400 })
  }

  const supabase = createServerClient()
  const skipResult = await recordTrendingSkip(supabase, userId, ticker)
  if (!skipResult.ok) {
    return NextResponse.json({ error: skipResult.error ?? 'Skip failed' }, { status: 400 })
  }

  const response = await buildWatchlistSuggestionsResponse(supabase, userId, false)

  return NextResponse.json(response, {
    headers: {
      ...NO_CACHE,
      'X-Market-Open': isPriceRefreshActive() ? '1' : '0',
    },
  })
}
