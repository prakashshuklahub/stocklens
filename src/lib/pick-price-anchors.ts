import type { createServerClient } from '@/lib/supabase'
import type { ScoredPick } from '@/lib/picks-scoring'

type Supabase = ReturnType<typeof createServerClient>

export type PickPriceAnchor = {
  suggested_price: number
  entry_low: number
  entry_high: number
  /** ISO — first time this ticker was suggested (never updated). */
  suggested_at: string
}

/** All permanent anchors — survives drop-off and re-entry on the picks list. */
export async function loadPermanentPickPriceAnchors(
  supabase: Supabase,
): Promise<Map<string, PickPriceAnchor>> {
  const map = new Map<string, PickPriceAnchor>()

  const { data, error } = await supabase
    .from('global_pick_price_anchors')
    .select('ticker, suggested_price, entry_low, entry_high, suggested_at')

  if (error) {
    if (error.message.includes('global_pick_price_anchors')) {
      console.warn('[pick-price-anchors] table missing — run migration 024')
      return map
    }
    console.warn('[pick-price-anchors] load failed:', error.message)
    return map
  }

  for (const row of data ?? []) {
    const suggested = Number(row.suggested_price)
    if (!Number.isFinite(suggested) || suggested <= 0) continue
    map.set(String(row.ticker).toUpperCase(), {
      suggested_price: suggested,
      entry_low: Number(row.entry_low),
      entry_high: Number(row.entry_high),
      suggested_at: row.suggested_at as string,
    })
  }

  return map
}

export type PickPriceAnchorInput = {
  ticker: string
  suggested_price?: number
  suggested_at?: string
  entry_low: number
  entry_high: number
  current_price: number
}

/** Insert anchors for newly suggested tickers only (never overwrite existing). */
export async function persistNewPickPriceAnchors(
  supabase: Supabase,
  snapshots: PickPriceAnchorInput[],
): Promise<void> {
  if (!snapshots.length) return

  const tickers = [...new Set(snapshots.map((p) => p.ticker.toUpperCase()))]
  const { data: existing, error: existingError } = await supabase
    .from('global_pick_price_anchors')
    .select('ticker')
    .in('ticker', tickers)

  if (existingError) {
    if (existingError.message.includes('global_pick_price_anchors')) return
    console.warn('[pick-price-anchors] persist lookup failed:', existingError.message)
    return
  }

  const have = new Set((existing ?? []).map((r) => String(r.ticker).toUpperCase()))
  const rows = snapshots
    .filter((p) => !have.has(p.ticker.toUpperCase()))
    .map((p) => {
      const suggested = p.suggested_price ?? p.entry_high ?? p.current_price
      return {
        ticker: p.ticker.toUpperCase(),
        suggested_price: suggested,
        entry_low: p.entry_low,
        entry_high: p.entry_high,
        suggested_at: p.suggested_at ?? new Date().toISOString(),
      }
    })
    .filter((r) => r.suggested_price > 0)

  if (!rows.length) return

  const { error: insertError } = await supabase.from('global_pick_price_anchors').insert(rows)
  if (insertError) {
    console.warn('[pick-price-anchors] persist insert failed:', insertError.message)
  }
}

export async function failStaleGlobalPicksRuns(supabase: Supabase): Promise<void> {
  const { error } = await supabase
    .from('global_top_picks_runs')
    .update({
      status: 'failed',
      published: false,
      error_message: 'Stale run — interrupted or timed out',
      completed_at: new Date().toISOString(),
    })
    .eq('status', 'running')

  if (error) {
    console.warn('[build-global-picks] fail stale runs:', error.message)
  }
}

export function applyPickPriceAnchor(
  pick: ScoredPick,
  anchors: Map<string, PickPriceAnchor>,
  firstSeenAt: string,
): ScoredPick & { suggested_price: number; suggested_at: string } {
  const prior = anchors.get(pick.ticker.toUpperCase())
  if (prior) {
    return {
      ...pick,
      suggested_price: prior.suggested_price,
      entry_low: prior.entry_low,
      entry_high: prior.entry_high,
      suggested_at: prior.suggested_at,
    }
  }

  return {
    ...pick,
    suggested_price: pick.suggested_price ?? pick.current_price,
    suggested_at: firstSeenAt,
  }
}
