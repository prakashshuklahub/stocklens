import type { createServerClient } from '@/lib/supabase'

export const NARRATIVE_TTL_HOURS = 6
/** Delay between sequential Gemini calls to reduce 429 rate limits. */
export const LLM_CALL_DELAY_MS = 500

type Supabase = ReturnType<typeof createServerClient>

export function narrativeTtlCutoff(): string {
  return new Date(Date.now() - NARRATIVE_TTL_HOURS * 3600 * 1000).toISOString()
}

/** Load fresh (within TTL) narrative rows for the given tickers. */
export async function loadFreshNarratives<T extends { ticker: string }>(
  supabase: Supabase,
  table: 'pick_narratives' | 'portfolio_sell_narratives',
  tickers: string[],
  logPrefix: string,
): Promise<Map<string, T>> {
  const result = new Map<string, T>()
  if (!tickers.length) return result

  const normalized = tickers.map((t) => t.toUpperCase())
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .in('ticker', normalized)
    .gte('generated_at', narrativeTtlCutoff())

  if (error) {
    console.warn(`[${logPrefix}] ${table} SELECT failed:`, error.message)
    return result
  }

  for (const row of (data ?? []) as T[]) {
    result.set(row.ticker.toUpperCase(), row)
  }

  return result
}

export async function upsertNarratives(
  supabase: Supabase,
  table: 'pick_narratives' | 'portfolio_sell_narratives',
  rows: Record<string, unknown>[],
  logPrefix: string,
): Promise<void> {
  if (!rows.length) return

  const { error } = await supabase.from(table).upsert(rows, { onConflict: 'ticker' })
  if (error) {
    console.warn(`[${logPrefix}] ${table} upsert failed:`, error.message)
  }
}

/** Run async work sequentially with a short delay between items (for LLM calls). */
export async function mapSequential<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  delayMs = LLM_CALL_DELAY_MS,
): Promise<R[]> {
  const out: R[] = []
  for (let i = 0; i < items.length; i++) {
    if (i > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs))
    out.push(await fn(items[i], i))
  }
  return out
}
