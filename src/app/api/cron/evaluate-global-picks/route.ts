import { evaluateGlobalPicksInDb } from '@/lib/cron/picks-accuracy'
import { env } from '@/lib/env'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

function authorized(req: NextRequest): boolean {
  const secret = env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/** Evaluate published Top Picks 30 days after run_date (idempotent). */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runDate = req.nextUrl.searchParams.get('run_date') ?? undefined
  const supabase = createServerClient()

  try {
    const result = await evaluateGlobalPicksInDb(supabase, { runDate })
    console.info(
      `[cron/evaluate-global-picks] runs=${result.runs_checked} evaluated=${result.picks_evaluated} skipped=${result.picks_skipped}`,
    )
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/evaluate-global-picks] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Evaluation failed' },
      { status: 500 },
    )
  }
}

export const maxDuration = 60
