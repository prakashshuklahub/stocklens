import { auth } from '@/lib/auth'
import { loadOrFetchResearch, RESEARCH_TTL_MS } from '@/lib/stock-research-cache'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ticker } = await params
  const sym = ticker.toUpperCase()
  const supabase = createServerClient()
  const result = await loadOrFetchResearch(supabase, sym)

  if (!result.ok) {
    if (result.reason === 'rate_limited') {
      const retrySec = Math.ceil(result.retryAfterMs / 1000)
      return NextResponse.json(
        {
          error: 'Yahoo rate limited — try again shortly',
          pending: true,
          retry_after_sec: retrySec,
        },
        { status: 503, headers: { 'Retry-After': String(retrySec) } },
      )
    }
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

export const maxDuration = 60
