import { usTradingDateString } from '@/lib/global-picks-schedule'
import { fetchLivePricesForTickers } from '@/lib/live-prices'
import type { createServerClient } from '@/lib/supabase'
import type { Pick } from '@/types'
import {
  closeOnOrBeforeDate,
  fetchYahooDailyCloses,
  returnPct,
} from '@/lib/yahoo-historical-close'

type Supabase = ReturnType<typeof createServerClient>

export const PICKS_ACCURACY_HORIZON_DAYS = 30

type PickRow = {
  id: string
  run_id: string
  rank: number
  ticker: string
  snapshot: Pick
}

type RunRow = {
  id: string
  run_date: string
  published: boolean
}

export type PickEvaluationRow = {
  pick_id: string
  run_id: string
  run_date: string
  ticker: string
  rank: number
  horizon_days: number
  price_at_publish: number
  target_at_publish: number | null
  upside_pct_at_publish: number | null
  entry_low_at_publish: number | null
  entry_high_at_publish: number | null
  price_at_eval: number | null
  return_pct: number | null
  spy_return_pct: number | null
  vs_spy_pct: number | null
  hit_target: boolean
  is_correct: boolean
}

export type EvaluateGlobalPicksResult = {
  horizon_days: number
  runs_checked: number
  picks_evaluated: number
  picks_skipped: number
  run_dates: string[]
}

function addCalendarDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

function isDueForEvaluation(
  runDate: string,
  horizonDays: number,
  today = usTradingDateString(),
): boolean {
  return addCalendarDaysYmd(runDate, horizonDays) <= today
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(2)
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`
}

export function buildEvaluationRow(
  pick: PickRow,
  runDate: string,
  priceAtEval: number | null,
  spyReturnPct: number | null,
  horizonDays = PICKS_ACCURACY_HORIZON_DAYS,
): PickEvaluationRow {
  const snap = pick.snapshot
  const priceAtPublish = snap.suggested_price ?? snap.current_price
  const targetAtPublish = snap.target_mean > 0 ? snap.target_mean : null
  const ret = priceAtEval != null ? returnPct(priceAtPublish, priceAtEval) : null
  const vsSpy =
    ret != null && spyReturnPct != null ? ret - spyReturnPct : null
  const hitTarget =
    targetAtPublish != null && priceAtEval != null && priceAtEval >= targetAtPublish
  const isCorrect = ret != null && ret > 0

  return {
    pick_id: pick.id,
    run_id: pick.run_id,
    run_date: runDate,
    ticker: pick.ticker.toUpperCase(),
    rank: pick.rank,
    horizon_days: horizonDays,
    price_at_publish: priceAtPublish,
    target_at_publish: targetAtPublish,
    upside_pct_at_publish: snap.upside_pct ?? null,
    entry_low_at_publish: snap.entry_low ?? null,
    entry_high_at_publish: snap.entry_high ?? null,
    price_at_eval: priceAtEval,
    return_pct: ret,
    spy_return_pct: spyReturnPct,
    vs_spy_pct: vsSpy,
    hit_target: hitTarget,
    is_correct: isCorrect,
  }
}

async function loadUnevaluatedRuns(
  supabase: Supabase,
  horizonDays: number,
): Promise<RunRow[]> {
  const today = usTradingDateString()
  const { data: runs, error } = await supabase
    .from('global_top_picks_runs')
    .select('id, run_date, published')
    .eq('published', true)
    .eq('status', 'completed')
    .order('run_date', { ascending: false })
    .limit(90)

  if (error) throw new Error(error.message)
  if (!runs?.length) return []

  const dueRuns = (runs as RunRow[]).filter((r) =>
    isDueForEvaluation(r.run_date, horizonDays, today),
  )
  if (!dueRuns.length) return []

  const runIds = dueRuns.map((r) => r.id)
  const { data: existing, error: evalError } = await supabase
    .from('global_pick_evaluations')
    .select('run_id')
    .in('run_id', runIds)
    .eq('horizon_days', horizonDays)

  if (evalError) throw new Error(evalError.message)

  const fullyEvaluated = new Set<string>()
  const evalCounts = new Map<string, number>()
  for (const row of existing ?? []) {
    evalCounts.set(row.run_id, (evalCounts.get(row.run_id) ?? 0) + 1)
  }

  const { data: pickCounts, error: countError } = await supabase
    .from('global_top_picks')
    .select('run_id')
    .in('run_id', runIds)

  if (countError) throw new Error(countError.message)

  const picksPerRun = new Map<string, number>()
  for (const row of pickCounts ?? []) {
    picksPerRun.set(row.run_id, (picksPerRun.get(row.run_id) ?? 0) + 1)
  }

  for (const [runId, count] of picksPerRun) {
    if ((evalCounts.get(runId) ?? 0) >= count) {
      fullyEvaluated.add(runId)
    }
  }

  return dueRuns.filter((r) => !fullyEvaluated.has(r.id))
}

export async function evaluateGlobalPicksInDb(
  supabase: Supabase,
  options: { horizonDays?: number; runDate?: string } = {},
): Promise<EvaluateGlobalPicksResult> {
  const horizonDays = options.horizonDays ?? PICKS_ACCURACY_HORIZON_DAYS

  let runs: RunRow[]
  if (options.runDate) {
    const { data, error } = await supabase
      .from('global_top_picks_runs')
      .select('id, run_date, published')
      .eq('run_date', options.runDate)
      .eq('published', true)
      .eq('status', 'completed')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) {
      return {
        horizon_days: horizonDays,
        runs_checked: 0,
        picks_evaluated: 0,
        picks_skipped: 0,
        run_dates: [],
      }
    }
    runs = [data as RunRow]
  } else {
    runs = await loadUnevaluatedRuns(supabase, horizonDays)
  }

  if (!runs.length) {
    return {
      horizon_days: horizonDays,
      runs_checked: 0,
      picks_evaluated: 0,
      picks_skipped: 0,
      run_dates: [],
    }
  }

  const spyCloses = await fetchYahooDailyCloses('SPY')
  let picksEvaluated = 0
  let picksSkipped = 0
  const runDates: string[] = []

  for (const run of runs) {
    const { data: pickRows, error: picksError } = await supabase
      .from('global_top_picks')
      .select('id, run_id, rank, ticker, snapshot')
      .eq('run_id', run.id)
      .order('rank', { ascending: true })

    if (picksError) throw new Error(picksError.message)
    const picks = (pickRows ?? []) as PickRow[]
    if (!picks.length) continue

    runDates.push(run.run_date)

    const tickers = picks.map((p) => p.ticker.toUpperCase())
    const live = await fetchLivePricesForTickers(tickers)

    const spyAtPublish = closeOnOrBeforeDate(spyCloses, run.run_date)
    const spyNow = live.get('SPY')?.price ?? spyCloses.at(-1)?.close ?? null
    const spyReturnPct =
      spyAtPublish != null && spyNow != null
        ? returnPct(spyAtPublish, spyNow)
        : null

    const rows: PickEvaluationRow[] = []
    for (const pick of picks) {
      const sym = pick.ticker.toUpperCase()
      const priceAtEval = live.get(sym)?.price ?? null
      if (priceAtEval == null) {
        picksSkipped++
        continue
      }

      rows.push(
        buildEvaluationRow(pick, run.run_date, priceAtEval, spyReturnPct, horizonDays),
      )
    }

    if (!rows.length) continue

    const { error: upsertError } = await supabase.from('global_pick_evaluations').upsert(
      rows.map((r) => ({
        ...r,
        evaluated_at: new Date().toISOString(),
      })),
      { onConflict: 'pick_id,horizon_days' },
    )

    if (upsertError) throw new Error(upsertError.message)
    picksEvaluated += rows.length
  }

  return {
    horizon_days: horizonDays,
    runs_checked: runs.length,
    picks_evaluated: picksEvaluated,
    picks_skipped: picksSkipped,
    run_dates: runDates,
  }
}

export type PickAccuracyReportPick = {
  rank: number
  ticker: string
  price_at_publish: number
  price_at_eval: number | null
  target_at_publish: number | null
  return_pct: number | null
  vs_spy_pct: number | null
  hit_target: boolean
  is_correct: boolean
}

export type PickAccuracyReport = {
  run_id: string
  run_date: string
  horizon_days: number
  evaluated_at: string
  spy_return_pct: number | null
  total_picks: number
  correct_count: number
  beat_spy_count: number
  avg_return_pct: number | null
  picks: PickAccuracyReportPick[]
}

export function formatAccuracyReportText(report: PickAccuracyReport): string {
  const lines: string[] = [
    `StockLens Top Picks — ${report.horizon_days}-day accuracy report`,
    `Run date: ${report.run_date} · Evaluated: ${report.evaluated_at.slice(0, 10)}`,
    '',
    `Summary: ${report.correct_count}/${report.total_picks} correct (${report.total_picks ? Math.round((report.correct_count / report.total_picks) * 100) : 0}%) · Avg return ${fmtPct(report.avg_return_pct)} · ${report.beat_spy_count}/${report.total_picks} beat SPY${report.spy_return_pct != null ? ` (${fmtPct(report.spy_return_pct)})` : ''}`,
    '',
    'Rank  Ticker  Publish   Now       Return   vs SPY   Target   Hit  OK',
  ]

  for (const p of report.picks) {
    lines.push(
      [
        String(p.rank).padStart(4),
        p.ticker.padEnd(6),
        `$${fmtMoney(p.price_at_publish)}`.padStart(8),
        `$${fmtMoney(p.price_at_eval)}`.padStart(9),
        fmtPct(p.return_pct).padStart(8),
        fmtPct(p.vs_spy_pct).padStart(8),
        `$${fmtMoney(p.target_at_publish)}`.padStart(8),
        (p.hit_target ? 'Yes' : 'No').padStart(4),
        (p.is_correct ? '✓' : '✗').padStart(3),
      ].join('  '),
    )
  }

  lines.push(
    '',
    'Rules: Correct = positive return since publish. Beat SPY = return > SPY over same window.',
  )

  return lines.join('\n')
}

export async function buildAccuracyReportForRun(
  supabase: Supabase,
  runId: string,
  horizonDays = PICKS_ACCURACY_HORIZON_DAYS,
): Promise<PickAccuracyReport | null> {
  const { data: run, error: runError } = await supabase
    .from('global_top_picks_runs')
    .select('id, run_date')
    .eq('id', runId)
    .maybeSingle()

  if (runError) throw new Error(runError.message)
  if (!run) return null

  const { data: evals, error: evalError } = await supabase
    .from('global_pick_evaluations')
    .select('*')
    .eq('run_id', runId)
    .eq('horizon_days', horizonDays)
    .order('rank', { ascending: true })

  if (evalError) throw new Error(evalError.message)
  if (!evals?.length) return null

  const picks: PickAccuracyReportPick[] = evals.map((e) => ({
    rank: e.rank,
    ticker: e.ticker,
    price_at_publish: Number(e.price_at_publish),
    price_at_eval: e.price_at_eval != null ? Number(e.price_at_eval) : null,
    target_at_publish: e.target_at_publish != null ? Number(e.target_at_publish) : null,
    return_pct: e.return_pct != null ? Number(e.return_pct) : null,
    vs_spy_pct: e.vs_spy_pct != null ? Number(e.vs_spy_pct) : null,
    hit_target: Boolean(e.hit_target),
    is_correct: Boolean(e.is_correct),
  }))

  const returns = picks
    .map((p) => p.return_pct)
    .filter((v): v is number => v != null && Number.isFinite(v))
  const avgReturn =
    returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : null

  const evaluatedAt = evals.reduce((latest, e) => {
    const t = e.evaluated_at as string
    return t > latest ? t : latest
  }, evals[0].evaluated_at as string)

  const spyReturn = evals[0].spy_return_pct != null ? Number(evals[0].spy_return_pct) : null

  return {
    run_id: run.id,
    run_date: run.run_date,
    horizon_days: horizonDays,
    evaluated_at: evaluatedAt,
    spy_return_pct: spyReturn,
    total_picks: picks.length,
    correct_count: picks.filter((p) => p.is_correct).length,
    beat_spy_count: picks.filter((p) => (p.vs_spy_pct ?? -Infinity) > 0).length,
    avg_return_pct: avgReturn,
    picks,
  }
}

export type SendPicksAccuracyReportResult = {
  reports_sent: number
  evaluations_created: number
  email: { sent: boolean; reason?: string; id?: string }
  run_dates: string[]
}

export async function sendPicksAccuracyReports(
  supabase: Supabase,
  options: {
    horizonDays?: number
    runDate?: string
    evaluateFirst?: boolean
    daysBack?: number
  } = {},
): Promise<SendPicksAccuracyReportResult> {
  const horizonDays = options.horizonDays ?? PICKS_ACCURACY_HORIZON_DAYS
  const evaluateFirst = options.evaluateFirst ?? true

  let evaluationsCreated = 0
  if (evaluateFirst) {
    const evalResult = await evaluateGlobalPicksInDb(supabase, {
      horizonDays,
      runDate: options.runDate,
    })
    evaluationsCreated = evalResult.picks_evaluated
  }

  let runIds: string[] = []

  if (options.runDate) {
    const { data, error } = await supabase
      .from('global_top_picks_runs')
      .select('id')
      .eq('run_date', options.runDate)
      .eq('published', true)
      .eq('status', 'completed')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (data) runIds = [data.id]
  } else {
    const since = new Date()
    since.setUTCDate(since.getUTCDate() - (options.daysBack ?? 7))
    const { data, error } = await supabase
      .from('global_pick_evaluations')
      .select('run_id')
      .eq('horizon_days', horizonDays)
      .gte('evaluated_at', since.toISOString())

    if (error) throw new Error(error.message)
    runIds = [...new Set((data ?? []).map((r) => r.run_id as string))]
  }

  if (!runIds.length) {
    return {
      reports_sent: 0,
      evaluations_created: evaluationsCreated,
      email: { sent: false, reason: 'No evaluations to report' },
      run_dates: [],
    }
  }

  const reports: PickAccuracyReport[] = []
  for (const runId of runIds) {
    const report = await buildAccuracyReportForRun(supabase, runId, horizonDays)
    if (report) reports.push(report)
  }

  if (!reports.length) {
    return {
      reports_sent: 0,
      evaluations_created: evaluationsCreated,
      email: { sent: false, reason: 'No report data' },
      run_dates: [],
    }
  }

  const body = reports.map(formatAccuracyReportText).join('\n\n' + '─'.repeat(60) + '\n\n')
  const subject =
    reports.length === 1
      ? `StockLens picks report — ${reports[0].run_date} (${horizonDays}d)`
      : `StockLens picks report — ${reports.length} runs (${horizonDays}d)`

  const { sendReportEmail } = await import('@/lib/email/resend')
  const emailResult = await sendReportEmail({ subject, text: body })

  for (const report of reports) {
    await supabase.from('global_pick_accuracy_reports').insert({
      run_id: report.run_id,
      run_date: report.run_date,
      horizon_days: report.horizon_days,
      total_picks: report.total_picks,
      correct_count: report.correct_count,
      beat_spy_count: report.beat_spy_count,
      avg_return_pct: report.avg_return_pct,
      report_json: report,
      emailed_at: emailResult.sent ? new Date().toISOString() : null,
    })
  }

  return {
    reports_sent: reports.length,
    evaluations_created: evaluationsCreated,
    email: emailResult.sent
      ? { sent: true, id: emailResult.id }
      : { sent: false, reason: emailResult.reason },
    run_dates: reports.map((r) => r.run_date),
  }
}
