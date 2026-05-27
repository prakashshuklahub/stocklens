import { auth } from '@/lib/auth'
import { chartRangeCacheSeconds, fetchYahooChartSeries, isChartRange } from '@/lib/yahoo-chart'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { ticker } = await params
  const sym = ticker.toUpperCase()
  const rangeParam = req.nextUrl.searchParams.get('range')
  const range = isChartRange(rangeParam) ? rangeParam : '1d'

  const chart = await fetchYahooChartSeries(sym, range)
  if (!chart) {
    return NextResponse.json({ error: 'Chart unavailable' }, { status: 502 })
  }

  return NextResponse.json(chart, {
    headers: { 'Cache-Control': `private, max-age=${chartRangeCacheSeconds(range)}` },
  })
}
