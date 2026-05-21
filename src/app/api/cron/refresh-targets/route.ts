import { refreshTargetsInDb } from '@/lib/cron/refresh-targets'
import { env } from '@/lib/env'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

function authorized(req: NextRequest): boolean {
  const secret = env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/**
 * Bulk refresh analyst targets into stock_fundamentals.
 * ?force=1 — refresh all tickers (use once to validate StockAnalysis in UI).
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const force = req.nextUrl.searchParams.get('force') === '1'
  const supabase = createServerClient()

  try {
    const result = await refreshTargetsInDb(supabase, { force })
    console.info(
      `[cron/refresh-targets] updated=${result.targets_updated}/${result.tickers_attempted} forced=${force}`,
    )
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/refresh-targets] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Refresh failed' },
      { status: 500 },
    )
  }
}

export const maxDuration = 120
