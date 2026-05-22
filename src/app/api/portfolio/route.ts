import { auth, getSessionUserId } from '@/lib/auth'
import { fetchStockSnapshotsForTickers } from '@/lib/live-prices'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
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
  const priceLive = isPriceRefreshActive()
  const prices = await fetchStockSnapshotsForTickers(tickers)
  const enriched = holdings.map((h) => ({
    ...h,
    snapshot: prices.get(h.ticker.toUpperCase()) ?? null,
  }))

  void ensureLogosForTickers(supabase, tickers).catch(() => {})

  return NextResponse.json(enriched, {
    headers: {
      'X-Market-Open': priceLive ? '1' : '0',
      'Cache-Control': priceLive ? 'private, no-store' : 'private, max-age=3600',
    },
  })
}
