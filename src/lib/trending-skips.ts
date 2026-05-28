import type { createServerClient } from '@/lib/supabase'

type Supabase = ReturnType<typeof createServerClient>

export const TRENDING_SKIP_TTL_HOURS = 24

export function trendingSkipCutoffIso(hours = TRENDING_SKIP_TTL_HOURS): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString()
}

export function isTrendingSkipActive(skippedAt: string, hours = TRENDING_SKIP_TTL_HOURS): boolean {
  return new Date(skippedAt).getTime() >= new Date(trendingSkipCutoffIso(hours)).getTime()
}

/** Tickers the user skipped within the last 24 hours. */
export async function loadActiveSkippedTickers(
  supabase: Supabase,
  userId: string,
): Promise<Set<string>> {
  const cutoff = trendingSkipCutoffIso()
  const { data, error } = await supabase
    .from('watchlist_trending_skips')
    .select('ticker, skipped_at')
    .eq('user_id', userId)
    .gte('skipped_at', cutoff)

  if (error) {
    if (error.message.includes('watchlist_trending_skips')) {
      return new Set()
    }
    console.warn('[trending-skips] SELECT failed:', error.message)
    return new Set()
  }

  return new Set(
    (data ?? []).map((row) => String(row.ticker).toUpperCase()),
  )
}

/** Hide a trending card for 24 hours (upsert refreshes the window). */
export async function recordTrendingSkip(
  supabase: Supabase,
  userId: string,
  ticker: string,
): Promise<{ ok: boolean; error?: string }> {
  const sym = ticker.trim().toUpperCase()
  if (!/^[A-Z]{1,5}$/.test(sym)) {
    return { ok: false, error: 'Invalid ticker' }
  }

  const { error } = await supabase.from('watchlist_trending_skips').upsert(
    {
      user_id: userId,
      ticker: sym,
      skipped_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,ticker' },
  )

  if (error) {
    if (error.message.includes('watchlist_trending_skips')) {
      return { ok: false, error: 'Skip table missing — run migration 017' }
    }
    return { ok: false, error: error.message }
  }

  return { ok: true }
}
