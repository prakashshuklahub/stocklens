/**
 * Benchmark unified /api/picks pipeline (top 10 global rank).
 * Run: set -a && source .env.local && set +a && npx tsx scripts/benchmark-picks.ts
 */

import { isLLMEnabled } from '@/lib/llm'
import { buildUnifiedPicksResponse } from '@/lib/picks-pipeline'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

function createBenchmarkSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as unknown as typeof WebSocket },
  })
}

function ms(start: number) {
  return Math.round(performance.now() - start)
}

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  const result = await fn()
  console.log(`  ${label.padEnd(44)} ${String(ms(t0)).padStart(6)} ms`)
  return result
}

async function main() {
  const total0 = performance.now()
  const supabase = createBenchmarkSupabase()

  console.log('\n=== Picks unified top-10 benchmark ===\n')

  const sampleUser = await time('1. Find user', async () => {
    const { data } = await supabase.from('watchlist_stocks').select('user_id').limit(1).maybeSingle()
    if (!data?.user_id) throw new Error('No watchlist data — add stocks in dev DB first')
    return data
  })

  const response = await time('2. buildUnifiedPicksResponse', () =>
    buildUnifiedPicksResponse(supabase, sampleUser.user_id, false, 'picks-bench'),
  )

  console.log(`     → top picks: ${response.picks.length}`)
  console.log(
    `     → sources: watchlist/portfolio ${response.your_picks.length}, strong movers ${response.discovery_picks.length}`,
  )
  console.log(`     → LLM enabled: ${isLLMEnabled()} (background LLM + headlines not timed)`)

  console.log(`\n  ${'TOTAL (critical path)'.padEnd(44)} ${String(ms(total0)).padStart(6)} ms\n`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
