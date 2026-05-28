/**
 * One-off: rebuild trending cache + refresh fundamentals/research for picks.
 * Run: set -a && source .env.local && set +a && npx tsx scripts/refresh-picks-now.ts
 */

import { refreshResearchInDb } from '@/lib/cron/refresh-research'
import { refreshFundamentalsForTickers } from '@/lib/load-fundamentals'
import { buildGlobalTrendingCache } from '@/lib/trending-cache-build'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

function createScriptSupabase() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as unknown as typeof WebSocket },
  })
}

async function main() {
  const supabase = createScriptSupabase()

  console.log('\n=== One-time picks data refresh ===\n')

  console.log('1/3 Rebuilding trending cache (Yahoo screeners + scoring)...')
  const trending = await buildGlobalTrendingCache(supabase, { skipBlurbs: true })
  console.log(
    '   Ranked',
    trending.ranked.length,
    'movers:',
    trending.ranked.map((s) => s.ticker).join(', ') || '(none)',
  )

  const tickers = [...new Set(trending.ranked.map((s) => s.ticker.toUpperCase()))]
  if (tickers.length) {
    console.log(`\n2/3 Refreshing fundamentals for trending tickers (${tickers.length})...`)
    await refreshFundamentalsForTickers(supabase, tickers, { upsert: true, concurrency: 3 })
    console.log('   Done.')
  } else {
    console.log('\n2/3 Skipping fundamentals (no trending tickers).')
  }

  console.log('\n3/3 Refreshing key research batch (Finnhub, up to 30 tickers)...')
  const research = await refreshResearchInDb(supabase)
  console.log(
    `   Updated ${research.research_updated}/${research.tickers_attempted} research rows`,
  )

  console.log('\n=== Refresh complete — reload /picks in the app ===\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
