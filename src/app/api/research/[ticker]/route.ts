import { auth } from '@/lib/auth'
import {
  ensureResearchForTicker,
  loadOrFetchResearch,
  RESEARCH_TTL_MS,
} from '@/lib/stock-research-cache'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

type RouteParams = { params: Promise<{ ticker: string }> }

/** Read cached research from DB (fetch on miss if panel opened). */
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ticker } = await params
  const sym = ticker.toUpperCase()
  const supabase = createServerClient()
  const result = await loadOrFetchResearch(supabase, sym)

  if (!result.ok) {
    return NextResponse.json(
      { error: 'Research not available yet', pending: true },
      { status: 404 },
    )
  }

  const ageMs = Date.now() - new Date(result.fetched_at).getTime()
  const maxAgeSec = Math.max(60, Math.ceil((RESEARCH_TTL_MS - ageMs) / 1000))

  return NextResponse.json(result.data, {
    headers: {
      'Cache-Control': `private, max-age=${Math.min(maxAgeSec, 3600)}`,
      ...(result.stale ? { 'X-Research-Stale': '1' } : {}),
    },
  })
}

/**
 * Bootstrap one ticker into stock_research_cache (e.g. right after add to watchlist).
 * ?force=1 refreshes even if a row exists.
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ticker } = await params
  const sym = ticker.toUpperCase()
  if (!/^[A-Z]{1,5}$/.test(sym)) {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 })
  }

  const force = req.nextUrl.searchParams.get('force') === '1'
  const supabase = createServerClient()
  const snapshot = await ensureResearchForTicker(supabase, sym, { onlyIfMissing: !force })

  if (!snapshot) {
    return NextResponse.json(
      { error: 'Could not fetch research for this ticker', pending: true },
      { status: 404 },
    )
  }

  return NextResponse.json(snapshot, { status: 201 })
}

export const maxDuration = 60
