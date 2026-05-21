import { auth, getSessionUserId } from '@/lib/auth'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

interface HoldingInput {
  ticker: string
  company_name: string
  quantity: number
  avg_cost_basis: number
}

export async function POST(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })

  const { holdings }: { holdings: HoldingInput[] } = await req.json()
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return NextResponse.json({ error: 'No holdings provided' }, { status: 400 })
  }

  const supabase = createServerClient()

  // Delete all existing Vested holdings for this user, then re-insert
  const { error: deleteError } = await supabase
    .from('portfolio_holdings')
    .delete()
    .eq('user_id', userId)
    .eq('broker', 'vested')

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  const rows = holdings.map((h) => ({
    user_id: userId,
    ticker: h.ticker.toUpperCase(),
    company_name: h.company_name,
    quantity: h.quantity,
    avg_cost_basis: h.avg_cost_basis,
    broker: 'vested',
    synced_at: new Date().toISOString(),
  }))

  const { error: insertError } = await supabase
    .from('portfolio_holdings')
    .insert(rows)

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  return NextResponse.json({ synced: rows.length })
}
