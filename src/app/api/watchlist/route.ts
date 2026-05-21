import { auth, getSessionUserId } from '@/lib/auth'
import { resolveSectorForTicker } from '@/lib/sectors'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

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

async function fetchLivePrices(tickers: string[]) {
  const map = new Map<string, { price: number; change_1d_pct: number }>()
  if (!tickers.length) return map
  // Fetch all in parallel — v8/chart is per-ticker but fast
  const results = await Promise.all(tickers.map(t => fetchOneTicker(t)))
  tickers.forEach((ticker, i) => {
    const r = results[i]
    if (r) map.set(ticker, r)
  })
  return map
}

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
  const prices = await fetchLivePrices(tickers)

  const enriched = stocks.map((s) => ({
    ...s,
    snapshot: prices.get(s.ticker) ?? null,
  }))

  return NextResponse.json(enriched)
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

  return NextResponse.json(data, { status: 201 })
}
