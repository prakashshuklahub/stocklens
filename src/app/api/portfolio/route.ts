import { auth, getSessionUserId } from '@/lib/auth'
import { fetchLivePricesForTickers } from '@/lib/live-prices'
import { isUSMarketOpen } from '@/lib/market-hours'
import { createServerClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function GET() {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })

  const supabase = createServerClient()
  const { data: holdings, error } = await supabase
    .from('portfolio_holdings')
    .select('*')
    .eq('user_id', userId)
    .order('synced_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!holdings?.length) return NextResponse.json([])

  const tickers = holdings.map((h) => h.ticker)
  const marketOpen = isUSMarketOpen()
  const prices = marketOpen ? await fetchLivePricesForTickers(tickers) : new Map()
  const enriched = holdings.map((h) => ({
    ...h,
    snapshot: prices.get(h.ticker) ?? null,
  }))

  return NextResponse.json(enriched, {
    headers: { 'X-Market-Open': marketOpen ? '1' : '0' },
  })
}
