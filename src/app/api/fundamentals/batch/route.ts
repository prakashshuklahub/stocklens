import { auth } from '@/lib/auth'
import { loadFundamentalsForTickers } from '@/lib/load-fundamentals'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

const MAX_TICKERS = 40

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const raw = req.nextUrl.searchParams.get('tickers') ?? ''
  const tickers = raw
    .split(',')
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_TICKERS)

  if (!tickers.length) {
    return NextResponse.json({ fundamentals: {} })
  }

  const supabase = createServerClient()
  const fundamentals = await loadFundamentalsForTickers(supabase, tickers)

  return NextResponse.json(
    { fundamentals },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  )
}
