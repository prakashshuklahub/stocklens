import { auth, getSessionUserId } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  const { ticker: raw } = await params
  const sym = decodeURIComponent(raw).toUpperCase().trim()
  if (!sym || !/^[A-Z]{1,5}$/.test(sym)) {
    return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 })
  }

  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('watchlist_stocks')
    .delete()
    .eq('user_id', userId)
    .eq('ticker', sym)
    .select('ticker')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data?.length) {
    return NextResponse.json({ error: `${sym} is not on your watchlist` }, { status: 404 })
  }
  return NextResponse.json({ success: true, ticker: sym })
}
