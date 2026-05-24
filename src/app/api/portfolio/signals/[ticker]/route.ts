import { auth, getSessionUserId } from '@/lib/auth'
import { fetchRegularSnapshotsForTickers } from '@/lib/live-prices'
import { loadFundamentalsCacheFirst } from '@/lib/load-fundamentals'
import { generateSellReview, isLLMEnabled } from '@/lib/llm'
import {
  loadFreshNarratives,
  narrativeSourceFromModel,
  upsertNarratives,
} from '@/lib/narrative-cache'
import { buildSellReviewInput, mechanicalSignalReview } from '@/lib/portfolio-alerts'
import { scoreHoldingSignal } from '@/lib/portfolio-alert-scoring'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import type { PortfolioHolding, StockFundamentals } from '@/types'

const LOG_PREFIX = 'portfolio/signals'
const NO_CACHE = { 'Cache-Control': 'private, no-store, max-age=0' } as const

/** Lazy AI narrative for an expanded holding signal accordion. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const { ticker: rawTicker } = await params
  const ticker = rawTicker.toUpperCase()
  const useLlm = req.nextUrl.searchParams.get('llm') === '1'

  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })

  const supabase = createServerClient()
  const { data: holding, error } = await supabase
    .from('portfolio_holdings')
    .select('*')
    .eq('user_id', userId)
    .eq('ticker', ticker)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!holding) return NextResponse.json({ error: 'Holding not found' }, { status: 404 })

  const h = holding as PortfolioHolding
  const priceMap = await fetchRegularSnapshotsForTickers([ticker])
  const price = priceMap.get(ticker)?.price ?? null
  if (price == null) return NextResponse.json({ error: 'Price unavailable' }, { status: 503 })

  const { fundamentals } = await loadFundamentalsCacheFirst(supabase, [ticker])
  const f = fundamentals[ticker] as StockFundamentals | undefined

  const scored = scoreHoldingSignal({
    holding: h,
    current_price: price,
    fundamentals: f ?? null,
  })

  if (scored.tier === 'quiet') {
    return NextResponse.json({ error: 'No signal for this holding' }, { status: 404 })
  }

  if (!useLlm || !isLLMEnabled()) {
    if (scored.tier === 'profit') {
      return NextResponse.json({
        review_reason: null,
        caveat: null,
        narrative_source: 'mechanical' as const,
        llm_enabled: isLLMEnabled(),
      }, { headers: NO_CACHE })
    }
    const mechanical = mechanicalSignalReview(
      scored.bearish!,
      scored.tier === 'attention' ? 'attention' : 'soft',
    )
    return NextResponse.json({
      ...mechanical,
      narrative_source: 'mechanical' as const,
      llm_enabled: isLLMEnabled(),
    }, { headers: NO_CACHE })
  }

  if (scored.tier === 'profit' || !scored.bearish) {
    return NextResponse.json({ error: 'AI summary not available for this signal type' }, { status: 400 })
  }

  const cached = await loadFreshNarratives<{
    ticker: string
    review_reason: string
    caveat: string
    model: string | null
  }>(supabase, 'portfolio_sell_narratives', [ticker], LOG_PREFIX)

  const hit = cached.get(ticker)
  if (hit) {
    return NextResponse.json({
      review_reason: hit.review_reason,
      caveat: hit.caveat,
      narrative_source: narrativeSourceFromModel(hit.model),
      llm_enabled: true,
    }, { headers: NO_CACHE })
  }

  const reviewInput = buildSellReviewInput(scored.bearish, f)
  const narrative = await generateSellReview(reviewInput)
  if (!narrative) {
    const fallback = mechanicalSignalReview(
      scored.bearish,
      scored.tier === 'attention' ? 'attention' : 'soft',
    )
    return NextResponse.json({
      ...fallback,
      narrative_source: 'mechanical' as const,
      llm_enabled: true,
    }, { headers: NO_CACHE })
  }

  await upsertNarratives(supabase, 'portfolio_sell_narratives', [{
    ticker,
    review_reason: narrative.review_reason,
    caveat: narrative.caveat,
    model: narrative.model,
    generated_at: new Date().toISOString(),
  }], LOG_PREFIX)

  return NextResponse.json({
    review_reason: narrative.review_reason,
    caveat: narrative.caveat,
    narrative_source: 'llm' as const,
    llm_enabled: true,
  }, { headers: NO_CACHE })
}
