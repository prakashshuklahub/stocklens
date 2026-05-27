import { refreshResearchInDb } from '@/lib/cron/refresh-research'
import { env } from '@/lib/env'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

function authorized(req: NextRequest): boolean {
  const secret = env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/** Hourly: refresh up to 20 stale research rows (3h TTL), paced for Yahoo rate limits. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  try {
    const result = await refreshResearchInDb(supabase)
    console.info(
      `[cron/refresh-research] updated=${result.research_updated}/${result.tickers_attempted} stale=${result.tickers_stale}/${result.tickers_total} rate_limited=${result.rate_limited}`,
    )
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/refresh-research] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Refresh failed' },
      { status: 500 },
    )
  }
}

export const maxDuration = 120
