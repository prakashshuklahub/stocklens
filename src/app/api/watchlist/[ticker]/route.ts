import { auth, getSessionUserId } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase'
import { replaceStockTags, TagValidationError } from '@/lib/watchlist-tags-db'
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

export async function PATCH(
  req: NextRequest,
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

  let body: { tags?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.tags)) {
    return NextResponse.json({ error: 'tags must be an array of strings' }, { status: 400 })
  }

  const tagNames = body.tags.map((t) => String(t ?? ''))

  const supabase = createServerClient()

  const { data: stock, error: stockError } = await supabase
    .from('watchlist_stocks')
    .select('id, ticker')
    .eq('user_id', userId)
    .eq('ticker', sym)
    .maybeSingle()

  if (stockError) return NextResponse.json({ error: stockError.message }, { status: 500 })
  if (!stock) {
    return NextResponse.json({ error: `${sym} is not on your watchlist` }, { status: 404 })
  }

  try {
    const tags = await replaceStockTags(supabase, userId, stock.id as string, tagNames)
    return NextResponse.json({ ticker: sym, tags })
  } catch (err) {
    if (err instanceof TagValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    const message = err instanceof Error ? err.message : 'Failed to update tags'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
