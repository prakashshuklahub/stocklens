/**
 * Global trending rankings cache (shared with watchlist suggestions).
 */

import { NARRATIVE_TTL_HOURS } from '@/lib/narrative-cache'
import type { createServerClient } from '@/lib/supabase'
import type { ScoredSuggestion } from '@/lib/watchlist-suggestions-scoring'

const TRENDING_CACHE_HOURS = NARRATIVE_TTL_HOURS

export type CachedTrendingReason = {
  reason: string
  narrative_source: 'llm' | 'mechanical'
}

export type CachedTrendingPayload = {
  ranked: ScoredSuggestion[]
  reasons: Record<string, CachedTrendingReason>
  generated_at: string
}

export async function loadTrendingCachePayload(
  supabase: ReturnType<typeof createServerClient>,
): Promise<CachedTrendingPayload | null> {
  const { data, error } = await supabase
    .from('watchlist_suggestions_cache')
    .select('suggestions, generated_at')
    .eq('cache_key', 'global')
    .maybeSingle()

  if (error) {
    console.warn('[trending-cache] SELECT failed:', error.message)
    return null
  }
  if (!data) return null

  const raw = data.suggestions as CachedTrendingPayload | ScoredSuggestion[]
  if (!raw) return null

  if (Array.isArray(raw)) {
    if (!raw.length) return null
    return { ranked: raw, reasons: {}, generated_at: data.generated_at }
  }

  if (!Array.isArray(raw.ranked) || !raw.ranked.length) return null
  return {
    ranked: raw.ranked,
    reasons: raw.reasons ?? {},
    generated_at: raw.generated_at ?? data.generated_at,
  }
}

export function isTrendingCacheFresh(generatedAt: string): boolean {
  const cutoff = Date.now() - TRENDING_CACHE_HOURS * 3600 * 1000
  return new Date(generatedAt).getTime() >= cutoff
}
