import { auth, getSessionUserId } from '@/lib/auth'
import { isLLMEnabled } from '@/lib/llm'
import { loadCachedPickNarratives, rowToNarrativePayload } from '@/lib/pick-narratives'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import type { PickNarrativePayload } from '@/types'

const NO_CACHE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' } as const
const LOG_PREFIX = 'picks/narratives'

/** Read cached pick narratives — client polls after /api/picks for LLM copy. */
export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  const raw = req.nextUrl.searchParams.get('tickers') ?? ''
  const tickers = [...new Set(raw.split(',').map((t) => t.trim().toUpperCase()).filter(Boolean))]
  if (!tickers.length) {
    return NextResponse.json({ narratives: {}, llm_enabled: isLLMEnabled() }, { headers: NO_CACHE_HEADERS })
  }

  const supabase = createServerClient()
  const cached = await loadCachedPickNarratives(supabase, tickers, LOG_PREFIX)

  const narratives: Record<string, PickNarrativePayload> = {}
  for (const ticker of tickers) {
    const row = cached.get(ticker)
    if (row) narratives[ticker] = rowToNarrativePayload(row)
  }

  return NextResponse.json({ narratives, llm_enabled: isLLMEnabled() }, { headers: NO_CACHE_HEADERS })
}
