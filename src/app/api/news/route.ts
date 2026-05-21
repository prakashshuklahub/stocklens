import { auth } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase'
import { fetchNewsForTicker } from '@/lib/news'
import { NextResponse } from 'next/server'

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const supabase = createServerClient()
  const { data: watchlist } = await supabase
    .from('watchlist_stocks')
    .select('ticker')
    .eq('user_id', session.user.id)

  if (!watchlist?.length) return NextResponse.json({ bullish: [], bearish: [] })

  const tickers = watchlist.map((w) => w.ticker)
  const topTickers = tickers.slice(0, 20)
  const allNews = (await Promise.all(topTickers.map(fetchNewsForTicker))).flat()

  const seen = new Set<string>()
  const unique = allNews.filter((item) => {
    const key = item.title.slice(0, 60).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  unique.sort((a, b) =>
    Math.abs(b.sentiment_score) - Math.abs(a.sentiment_score) ||
    new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  )

  const bullish = unique.filter((n) => n.sentiment === 'bullish').slice(0, 15)
  const bearish = unique.filter((n) => n.sentiment === 'bearish').slice(0, 15)

  return NextResponse.json({ bullish, bearish })
}
