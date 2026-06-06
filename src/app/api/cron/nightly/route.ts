import { cronAuthorized } from '@/lib/cron/cron-auth'
import { cronRouteGuard } from '@/lib/cron/route-guard'
import { runNightlyCronJobs } from '@/lib/cron/run-nightly-jobs'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 300

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const blocked = cronRouteGuard('cron/nightly')
  if (blocked) return blocked

  try {
    const supabase = createServerClient()
    const result = await runNightlyCronJobs(supabase)
    const failed = Object.entries(result.steps).filter(([, s]) => !s.ok)
    console.info(
      `[cron/nightly] done steps=${Object.keys(result.steps).length} failed=${failed.length}`,
    )
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/nightly] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Nightly cron failed' },
      { status: 500 },
    )
  }
}
