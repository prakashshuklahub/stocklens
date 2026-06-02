/**
 * Evaluate Top Picks accuracy and optionally email a report.
 *
 * Evaluate only:
 *   set -a && source .env.local && set +a && npx tsx scripts/run-picks-accuracy-report.ts --evaluate
 *
 * Report for a specific run (evaluates first if needed):
 *   npx tsx scripts/run-picks-accuracy-report.ts --run-date=2026-06-02 --email
 *
 * Weekly-style report (evaluations from last 7 days):
 *   npx tsx scripts/run-picks-accuracy-report.ts --email
 */

import {
  sendPicksAccuracyReports,
  evaluateGlobalPicksInDb,
  buildAccuracyReportForRun,
  formatAccuracyReportText,
} from '@/lib/cron/picks-accuracy'
import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`
  for (const arg of process.argv.slice(2)) {
    if (arg === `--${name}`) return '1'
    if (arg.startsWith(prefix)) return arg.slice(prefix.length)
  }
  return undefined
}

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

  const runDate = parseArg('run-date')
  const evaluateOnly = process.argv.includes('--evaluate')
  const sendEmail = process.argv.includes('--email')

  if (evaluateOnly && !sendEmail) {
    console.log('Evaluating global picks…')
    const result = await evaluateGlobalPicksInDb(supabase, { runDate })
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (runDate && !sendEmail) {
    console.log(`Evaluating run ${runDate}…`)
    await evaluateGlobalPicksInDb(supabase, { runDate })
    const { data: run } = await supabase
      .from('global_top_picks_runs')
      .select('id')
      .eq('run_date', runDate)
      .eq('published', true)
      .maybeSingle()
    if (run?.id) {
      const report = await buildAccuracyReportForRun(supabase, run.id)
      if (report) console.log(formatAccuracyReportText(report))
    }
    return
  }

  console.log('Building picks accuracy report…')
  const result = await sendPicksAccuracyReports(supabase, {
    runDate,
    evaluateFirst: true,
    daysBack: runDate ? undefined : 7,
  })

  console.log(JSON.stringify(result, null, 2))

  if (sendEmail && !result.email.sent) {
    console.warn('Email not sent:', result.email.reason)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
