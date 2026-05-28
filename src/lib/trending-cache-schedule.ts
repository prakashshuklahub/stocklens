/**
 * Background trending cache rebuild — avoids blocking picks on Yahoo screeners.
 */

import { buildGlobalTrendingCache } from '@/lib/trending-cache-build'
import { isTrendingCacheFresh, loadTrendingCachePayload } from '@/lib/trending-cache'
import type { createServerClient } from '@/lib/supabase'

type Supabase = ReturnType<typeof createServerClient>

let rebuildInflight: Promise<void> | null = null

function runTrendingRebuild(supabase: Supabase, reason: string): Promise<void> {
  if (rebuildInflight) return rebuildInflight

  rebuildInflight = buildGlobalTrendingCache(supabase, { skipBlurbs: true })
    .then(() => {
      console.info(`[trending-cache] background rebuild complete (${reason})`)
    })
    .catch((err) => {
      console.warn('[trending-cache] background rebuild failed:', err)
    })
    .finally(() => {
      rebuildInflight = null
    })

  return rebuildInflight
}

/** Rebuild global trending cache when empty or past TTL. Dedupes concurrent rebuilds. */
export async function rebuildTrendingCacheIfNeeded(supabase: Supabase): Promise<void> {
  const cached = await loadTrendingCachePayload(supabase)
  if (!cached?.generated_at) {
    await runTrendingRebuild(supabase, 'empty')
    return
  }
  if (!isTrendingCacheFresh(cached.generated_at)) {
    await runTrendingRebuild(supabase, 'stale')
  }
}
