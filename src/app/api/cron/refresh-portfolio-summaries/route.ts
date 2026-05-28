import { refreshPortfolioSummariesInDb } from '@/lib/cron/refresh-portfolio-summaries'
import { cronRouteGuard } from '@/lib/cron/route-guard'
import { env } from '@/lib/env'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

function authorized(req: NextRequest): boolean {
  const secret = env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/** Batch refresh stale portfolio daily summaries (3h TTL). */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const blocked = cronRouteGuard('cron/refresh-portfolio-summaries')
  if (blocked) return blocked

  const supabase = createServerClient()

  try {
    const result = await refreshPortfolioSummariesInDb(supabase)
    console.info(
      `[cron/refresh-portfolio-summaries] written=${result.summaries_written}/${result.users_attempted} skipped_fresh=${result.users_skipped_fresh}`,
    )
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/refresh-portfolio-summaries] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Refresh failed' },
      { status: 500 },
    )
  }
}

export const maxDuration = 120
