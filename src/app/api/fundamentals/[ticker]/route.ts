import { auth } from '@/lib/auth'
import { fetchStockFundamentals } from '@/lib/fundamentals-fetch'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import type { StockFundamentals } from '@/types'

const CACHE_MINUTES = 30

function isMissingTableError(message: string | undefined): boolean {
  return Boolean(message?.includes('stock_fundamentals') || message?.includes('PGRST205'))
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ticker } = await params
  const sym = ticker.toUpperCase()
  const supabase = createServerClient()

  const cutoff = new Date(Date.now() - CACHE_MINUTES * 60 * 1000).toISOString()
  const { data: cached, error: cacheError } = await supabase
    .from('stock_fundamentals')
    .select('*')
    .eq('ticker', sym)
    .gte('fetched_at', cutoff)
    .maybeSingle()

  if (cached && !cacheError) {
    return NextResponse.json(cached as StockFundamentals, {
      headers: { 'X-Cache': 'HIT', 'Cache-Control': 'private, max-age=300' },
    })
  }

  const fresh = await fetchStockFundamentals(sym)

  if (!isMissingTableError(cacheError?.message)) {
    const { error: upsertError } = await supabase
      .from('stock_fundamentals')
      .upsert({ ...fresh, fetched_at: new Date().toISOString() }, { onConflict: 'ticker' })
    if (upsertError) {
      console.error(`[fundamentals] upsert failed for ${sym}:`, upsertError.message)
    }
  } else {
    console.warn('[fundamentals] stock_fundamentals table missing — run supabase/migrations/run_once_combined.sql')
  }

  return NextResponse.json(fresh, {
    headers: { 'X-Cache': 'MISS', 'Cache-Control': 'private, max-age=300' },
  })
}
