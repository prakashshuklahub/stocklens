import { auth, getSessionUserId } from '@/lib/auth'
import { isLLMEnabled } from '@/lib/llm'
import { loadOrRefreshPortfolioSummary } from '@/lib/portfolio-summary-generate'
import { regeneratePortfolioSummaryIfNeeded } from '@/lib/portfolio-summary-schedule'
import { createServerClient } from '@/lib/supabase'
import { after, NextRequest, NextResponse } from 'next/server'
import type { PortfolioSummaryResponse } from '@/types'

const NO_CACHE = { 'Cache-Control': 'private, no-store, max-age=0' } as const

export async function GET(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  const forceRefresh = req.nextUrl.searchParams.get('refresh') === '1'
  const supabase = createServerClient()
  const { summary, stale, refreshing } = await loadOrRefreshPortfolioSummary(supabase, userId)

  if (stale || forceRefresh) {
    after(async () => {
      await regeneratePortfolioSummaryIfNeeded(
        supabase,
        userId,
        forceRefresh ? 'portfolio-refresh-button' : 'portfolio-page',
        forceRefresh,
      )
    })
  }

  const response: PortfolioSummaryResponse = {
    summary,
    stale: forceRefresh ? true : stale,
    /** True only while DB lock / Gemini run is in progress — not merely because cache TTL expired. */
    refreshing,
    llm_enabled: isLLMEnabled(),
  }

  return NextResponse.json(response, { headers: NO_CACHE })
}
