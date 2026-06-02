import { sendPicksAccuracyReports } from '@/lib/cron/picks-accuracy'
import { env } from '@/lib/env'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

function authorized(req: NextRequest): boolean {
  const secret = env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/** Weekly email: 30-day pick accuracy for recently evaluated runs. */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runDate = req.nextUrl.searchParams.get('run_date') ?? undefined
  const skipEvaluate = req.nextUrl.searchParams.get('skip_evaluate') === '1'
  const supabase = createServerClient()

  try {
    const result = await sendPicksAccuracyReports(supabase, {
      runDate,
      evaluateFirst: !skipEvaluate,
    })
    console.info(
      `[cron/send-picks-accuracy-report] reports=${result.reports_sent} email=${result.email.sent}`,
    )
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/send-picks-accuracy-report] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Report failed' },
      { status: 500 },
    )
  }
}

export const maxDuration = 60
