import { buildGlobalPicksInDb } from '@/lib/cron/build-global-picks'
import { cronRouteGuard } from '@/lib/cron/route-guard'
import { env } from '@/lib/env'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

function authorized(req: NextRequest): boolean {
  const secret = env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/** Nightly global Top Picks — DB-only scoring (no Yahoo/Finnhub in this job). */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const blocked = cronRouteGuard('cron/build-global-picks')
  if (blocked) return blocked

  const supabase = createServerClient()

  try {
    const result = await buildGlobalPicksInDb(supabase)
    console.info(
      `[cron/build-global-picks] status=${result.status} published=${result.published} qualified=${result.qualified_count} universe=${result.universe_count}`,
    )
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/build-global-picks] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Build failed' },
      { status: 500 },
    )
  }
}

export const maxDuration = 120
