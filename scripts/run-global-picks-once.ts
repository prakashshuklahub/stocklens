/**
 * One-off: build global top picks (bypasses cron window + HTTP auth).
 * Run: set -a && source .env.local && set +a && npx tsx scripts/run-global-picks-once.ts
 */

import { buildGlobalPicksInDb } from '@/lib/cron/build-global-picks'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

async function main() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env')
  }

  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws as unknown as typeof WebSocket },
  })

  console.log('Building global top picks…')
  const result = await buildGlobalPicksInDb(supabase)
  console.log(JSON.stringify(result, null, 2))

  if (result.status === 'failed') {
    console.error('Build failed — check global_top_picks_runs.error_message in Supabase')
    process.exit(1)
  }
  if (!result.published) {
    console.warn(
      `Run completed but not published (need >= 3 qualifiers; got ${result.qualified_count}).`,
    )
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
