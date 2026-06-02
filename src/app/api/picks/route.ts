import { auth, getSessionUserId } from '@/lib/auth'
import { buildGlobalPicksApiResponse } from '@/lib/global-picks-response'
import { PICKS_NO_CACHE_HEADERS } from '@/lib/picks-pipeline'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

/** Top buy ideas — shared nightly list from global_top_picks. */
export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  const supabase = createServerClient()

  const response = await buildGlobalPicksApiResponse(supabase, userId, {
    overlayLivePrices: true,
  })

  return NextResponse.json(response, { headers: PICKS_NO_CACHE_HEADERS })
}
