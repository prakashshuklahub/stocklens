import { auth } from '@/lib/auth'
import { loadFundamentalsForTickers } from '@/lib/load-fundamentals'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { ticker } = await params
  const sym = ticker.toUpperCase()
  const supabase = createServerClient()

  const fundamentals = await loadFundamentalsForTickers(supabase, [sym])
  const row = fundamentals[sym]
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  return NextResponse.json(row, {
    headers: { 'Cache-Control': 'private, max-age=300' },
  })
}
