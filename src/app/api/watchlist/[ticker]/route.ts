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

  const { ticker } = await params
  const supabase = createServerClient()

  const { error } = await supabase
    .from('watchlist_stocks')
    .delete()
    .eq('user_id', userId)
    .eq('ticker', ticker.toUpperCase())

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
