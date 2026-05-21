import { auth, getSessionUserId } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

async function fetchOneTicker(ticker: string): Promise<{ price: number; change_1d_pct: number } | null> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }
    )
    if (!res.ok) return null
    const data = await res.json()
    const meta = data?.chart?.result?.[0]?.meta
    if (!meta?.regularMarketPrice) return null
    const price: number = meta.regularMarketPrice
    const prevClose: number = meta.chartPreviousClose ?? meta.previousClose ?? price
    const change_1d_pct = prevClose ? ((price - prevClose) / prevClose) * 100 : 0
    return { price, change_1d_pct }
  } catch {
    return null
  }
}

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
  const results = await Promise.all(tickers.map(fetchOneTicker))
  const enriched = holdings.map((h, i) => ({
    ...h,
    snapshot: results[i] ?? null,
  }))

  return NextResponse.json(enriched)
}
