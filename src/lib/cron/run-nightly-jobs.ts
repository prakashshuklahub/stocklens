import { buildGlobalPicksInDb } from '@/lib/cron/build-global-picks'
import {
  evaluateGlobalPicksInDb,
  sendPicksAccuracyReports,
} from '@/lib/cron/picks-accuracy'
import { refreshPortfolioSummariesInDb } from '@/lib/cron/refresh-portfolio-summaries'
import { refreshResearchInDb } from '@/lib/cron/refresh-research'
import { refreshTargetsInDb } from '@/lib/cron/refresh-targets'
import { isIstMonday } from '@/lib/cron/window'
import type { createServerClient } from '@/lib/supabase'

type Supabase = ReturnType<typeof createServerClient>

type StepResult = { ok: true; result: unknown } | { ok: false; error: string }

export type NightlyCronResult = {
  skipped?: boolean
  reason?: string
  steps: Record<string, StepResult>
}

async function runStep(name: string, fn: () => Promise<unknown>): Promise<StepResult> {
  try {
    const result = await fn()
    console.info(`[cron/nightly] ${name} ok`)
    return { ok: true, result }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    console.error(`[cron/nightly] ${name} failed:`, err)
    return { ok: false, error }
  }
}

/**
 * Single nightly pipeline (same order as former separate Vercel crons):
 * targets → research → portfolio summaries → global picks → evaluate picks
 * (+ weekly accuracy email on IST Monday).
 */
export async function runNightlyCronJobs(supabase: Supabase): Promise<NightlyCronResult> {
  const steps: Record<string, StepResult> = {}

  steps.targets = await runStep('refresh-targets', () => refreshTargetsInDb(supabase))
  steps.research = await runStep('refresh-research', () => refreshResearchInDb(supabase))
  steps.portfolio_summaries = await runStep('refresh-portfolio-summaries', () =>
    refreshPortfolioSummariesInDb(supabase),
  )
  steps.global_picks = await runStep('build-global-picks', () => buildGlobalPicksInDb(supabase))
  steps.evaluate_picks = await runStep('evaluate-global-picks', () =>
    evaluateGlobalPicksInDb(supabase),
  )

  if (isIstMonday()) {
    steps.picks_accuracy_report = await runStep('send-picks-accuracy-report', () =>
      sendPicksAccuracyReports(supabase, { evaluateFirst: false }),
    )
  }

  return { steps }
}
