import { auth, getSessionUserId } from '@/lib/auth'
import { fetchPickHeadlinesForTickers } from '@/lib/pick-headlines'
import { PICKS_NO_CACHE_HEADERS } from '@/lib/picks-pipeline'
import { NextRequest, NextResponse } from 'next/server'
import type { PickHeadlinesResponse } from '@/types'

/** Headlines for displayed picks — client loads after section APIs. */
export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  const raw = req.nextUrl.searchParams.get('tickers') ?? ''
  const tickers = [...new Set(raw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean))]

  if (!tickers.length) {
    return NextResponse.json({ headlines: {} } satisfies PickHeadlinesResponse, {
      headers: PICKS_NO_CACHE_HEADERS,
    })
  }

  const byTicker = await fetchPickHeadlinesForTickers(tickers)
  const headlines: PickHeadlinesResponse['headlines'] = {}
  for (const ticker of tickers) {
    headlines[ticker] = byTicker.get(ticker) ?? []
  }

  return NextResponse.json({ headlines } satisfies PickHeadlinesResponse, { headers: PICKS_NO_CACHE_HEADERS })
}
