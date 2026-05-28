/**
 * One-off: refresh portfolio daily summaries for all users with holdings.
 * Run: set -a && source .env.local && set +a && npx tsx scripts/refresh-portfolio-summaries-now.ts
 */

import { refreshPortfolioSummariesInDb } from '@/lib/cron/refresh-portfolio-summaries'
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
  console.log('\n=== Portfolio daily summary refresh ===\n')
  const result = await refreshPortfolioSummariesInDb(supabase)
  console.log(result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
