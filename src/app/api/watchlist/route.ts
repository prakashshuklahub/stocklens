import { auth, getSessionUserId } from '@/lib/auth'
import { fetchStockSnapshotsForTickers } from '@/lib/live-prices'
import { isPriceRefreshActive } from '@/lib/market-hours'
import { resolveSectorForTicker } from '@/lib/sectors'
import { ensureLogosForTickers } from '@/lib/stock-logo-cache'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  const supabase = createServerClient()
  const { data: stocks, error } = await supabase
    .from('watchlist_stocks')
    .select('*')
    .eq('user_id', userId)
    .order('added_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!stocks?.length) return NextResponse.json([])

  const tickers = stocks.map((s) => s.ticker)
  const priceLive = isPriceRefreshActive()
  const prices = await fetchStockSnapshotsForTickers(tickers)

  const enriched = stocks.map((s) => ({
    ...s,
    snapshot: prices.get(s.ticker.toUpperCase()) ?? null,
  }))

  void ensureLogosForTickers(supabase, tickers).catch((err) => {
    console.warn('[watchlist] logo warm failed:', err instanceof Error ? err.message : err)
  })

  return NextResponse.json(enriched, {
    headers: {
      'X-Market-Open': priceLive ? '1' : '0',
      'Cache-Control': priceLive ? 'private, no-store' : 'private, max-age=3600',
    },
  })
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  const { ticker, company_name, sector } = await req.json()
  const sym = String(ticker ?? '').toUpperCase()
  if (!sym || !/^[A-Z]{1,5}$/.test(sym)) {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 })
  }

  const resolvedSector = await resolveSectorForTicker(sym, sector)

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('watchlist_stocks')
    .insert({
      user_id: userId,
      ticker: sym,
      company_name,
      sector: resolvedSector,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: `${ticker} is already in your watchlist` }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  void ensureLogosForTickers(supabase, [sym]).catch(() => {})

  return NextResponse.json(data, { status: 201 })
}
