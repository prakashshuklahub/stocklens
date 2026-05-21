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
  console.info(`[fundamentals/batch] loading ${tickers.length} tickers: ${tickers.slice(0, 5).join(',')}${tickers.length > 5 ? '…' : ''}`)
  const fundamentals = await loadFundamentalsForTickers(supabase, tickers)
  const withTarget = tickers.filter((t) => {
    const f = fundamentals[t]
    return f?.target_source && f.target_source !== '52w_high'
  })
  console.info(`[fundamentals/batch] done ${tickers.length} tickers, ${withTarget.length} analyst targets`)

  return NextResponse.json(
    { fundamentals },
    { headers: { 'Cache-Control': 'private, max-age=300' } },
  )
}
