/**
 * One-off: portfolio totals for a user by email.
 * Run: set -a && source .env.local && set +a && npx tsx scripts/check-user-portfolio.ts [email]
 */

import { createClient } from '@supabase/supabase-js'
import ws from 'ws'
import { fetchRegularSnapshotsForTickers } from '@/lib/live-prices'
import { computePortfolioDayPct } from '@/lib/portfolio-summary-generate'
import type { PortfolioHolding } from '@/types'

async function main() {
  const email = process.argv[2] ?? 'piyushmishra462@gmail.com'
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: ws as unknown as typeof WebSocket },
    },
  )

  const { data: user, error: uErr } = await supabase
    .from('users')
    .select('id, email')
    .eq('email', email)
    .single()
  if (uErr || !user) throw new Error(uErr?.message ?? 'user not found')

  const { data: holdings, error: hErr } = await supabase
    .from('portfolio_holdings')
    .select('ticker, quantity, avg_cost_basis, synced_at')
    .eq('user_id', user.id)
    .order('ticker')
  if (hErr) throw new Error(hErr.message)
  if (!holdings?.length) {
    console.log(`No holdings for ${email}`)
    return
  }

  const prices = await fetchRegularSnapshotsForTickers(holdings.map((h) => h.ticker))

  let totalValue = 0
  let totalCost = 0
  let dayPnl = 0
  const rows: Array<{
    ticker: string
    value: number
    cost: number
    unrealized: number
    todayUsd: number | null
    todayPct: number | null
  }> = []

  for (const h of holdings) {
    const snap = prices.get(h.ticker.toUpperCase())
    const price = snap?.price ?? null
    const d1 = snap?.change_1d_pct ?? null
    const qty = Number(h.quantity)
    const cost = qty * Number(h.avg_cost_basis)
    const value = price != null ? qty * price : 0
    totalCost += cost
    totalValue += value
    let todayUsd: number | null = null
    if (price != null && d1 != null) {
      todayUsd = (price - price / (1 + d1 / 100)) * qty
      dayPnl += todayUsd
    }
    rows.push({ ticker: h.ticker, value, cost, unrealized: value - cost, todayPct: d1, todayUsd })
  }

  rows.sort((a, b) => b.value - a.value)
  const dayPct = computePortfolioDayPct(holdings as PortfolioHolding[], prices)
  const lastSync = holdings.map((h) => h.synced_at).filter(Boolean).sort().pop()
  const fmt = (n: number) => Math.round(n * 100) / 100
  const unreal = totalValue - totalCost

  console.log(`\n${user.email} — ${holdings.length} holdings`)
  console.log(`Last sync: ${lastSync ?? 'unknown'}\n`)
  console.log(`Portfolio value:  $${fmt(totalValue).toLocaleString()}`)
  console.log(
    `Today:            ${dayPnl >= 0 ? '+' : ''}$${fmt(dayPnl).toLocaleString()} (${dayPct != null ? `${dayPct >= 0 ? '+' : ''}${fmt(dayPct)}%` : 'n/a'})`,
  )
  console.log(`Cost basis:       $${fmt(totalCost).toLocaleString()}`)
  console.log(
    `Unrealized P&L:   ${unreal >= 0 ? '+' : ''}$${fmt(unreal).toLocaleString()} (${fmt((unreal / totalCost) * 100)}%)\n`,
  )
  console.log('By holding (value | today | unrealized):')
  for (const r of rows) {
    const today =
      r.todayUsd != null && r.todayPct != null
        ? `${r.todayUsd >= 0 ? '+' : ''}$${fmt(r.todayUsd)} (${r.todayPct >= 0 ? '+' : ''}${fmt(r.todayPct)}%)`
        : 'n/a'
    const ur = r.unrealized >= 0 ? '+' : ''
    console.log(
      `  ${r.ticker.padEnd(5)} $${fmt(r.value).toLocaleString().padStart(10)} | ${today.padStart(22)} | ${ur}$${fmt(r.unrealized)}`,
    )
  }
  console.log('')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
