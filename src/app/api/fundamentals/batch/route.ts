import { auth } from '@/lib/auth'
import {
  loadFundamentalsCacheFirst,
  refreshFundamentalsForTickers,
} from '@/lib/load-fundamentals'
import { createServerClient } from '@/lib/supabase'
import { after, NextRequest, NextResponse } from 'next/server'

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
    return NextResponse.json({ fundamentals: {}, refreshing: false })
  }

  const supabase = createServerClient()
  const { fundamentals, stale } = await loadFundamentalsCacheFirst(supabase, tickers)

  if (stale.length) {
    console.info(
      `[fundamentals/batch] cache hit ${tickers.length - stale.length}/${tickers.length}, refreshing ${stale.length} in background`,
    )
    after(async () => {
      await refreshFundamentalsForTickers(supabase, stale)
    })
  } else {
    console.info(`[fundamentals/batch] cache hit ${tickers.length}/${tickers.length}`)
  }

  return NextResponse.json(
    { fundamentals, refreshing: stale.length > 0 },
    { headers: { 'Cache-Control': 'private, max-age=60' } },
  )
}
