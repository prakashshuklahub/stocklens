import { auth } from '@/lib/auth'
import { normalizeSector } from '@/lib/sectors'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const q = req.nextUrl.searchParams.get('q')?.trim()
  if (!q) return NextResponse.json([])

  try {
    const [searchRes, ] = await Promise.all([
      fetch(
        `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0&enableNavLinks=false`,
        { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 30 } }
      ),
    ])

    if (!searchRes.ok) return NextResponse.json([])

    const searchData = await searchRes.json()
    const rawQuotes = (searchData?.quotes ?? [])
      .filter((r: { quoteType: string; symbol: string }) => r.quoteType === 'EQUITY' && !r.symbol.includes('.'))
      .slice(0, 7)

    if (!rawQuotes.length) return NextResponse.json([])

    // Fetch live prices in parallel via v8 chart endpoint
    const priceMap = new Map<string, { price: number; change_pct: number }>()
    await Promise.all(
      rawQuotes.map(async (r: { symbol: string }) => {
        try {
          const res = await fetch(
            `https://query1.finance.yahoo.com/v8/finance/chart/${r.symbol}?interval=1d&range=1d`,
            { headers: { 'User-Agent': 'Mozilla/5.0' }, next: { revalidate: 30 } }
          )
          if (!res.ok) return
          const data = await res.json()
          const meta = data?.chart?.result?.[0]?.meta
          if (!meta?.regularMarketPrice) return
          const price: number = meta.regularMarketPrice
          const prev: number = meta.chartPreviousClose ?? meta.previousClose ?? price
          priceMap.set(r.symbol, {
            price,
            change_pct: prev ? ((price - prev) / prev) * 100 : 0,
          })
        } catch { /* non-fatal */ }
      })
    )

    const results = rawQuotes.map((r: {
      symbol: string
      shortname?: string
      longname?: string
      sector?: string
    }) => ({
      ticker: r.symbol,
      company_name: r.longname || r.shortname || r.symbol,
      sector: (() => {
        const s = normalizeSector(r.sector)
        return s === 'Other' ? null : s
      })(),
      price: priceMap.get(r.symbol)?.price ?? null,
      change_pct: priceMap.get(r.symbol)?.change_pct ?? null,
    }))

    return NextResponse.json(results)
  } catch (err) {
    console.error('Search error:', err)
    return NextResponse.json([])
  }
}
