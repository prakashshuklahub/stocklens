import {
  normalizeWatchlistTagKey,
  validateWatchlistTagList,
  WATCHLIST_MAX_TAGS_PER_USER,
  type WatchlistTagRef,
} from '@/lib/watchlist-tags'
import type { createServerClient } from '@/lib/supabase'

type Supabase = ReturnType<typeof createServerClient>

type TagRow = { id: string; name: string; name_normalized: string }
type StockTagRow = {
  watchlist_stock_id: string
  tag_id: string
  watchlist_tags: TagRow | TagRow[] | null
}

export async function loadTagsByStockIds(
  supabase: Supabase,
  userId: string,
  stockIds: string[],
): Promise<Map<string, WatchlistTagRef[]>> {
  const map = new Map<string, WatchlistTagRef[]>()
  if (!stockIds.length) return map

  const { data, error } = await supabase
    .from('watchlist_stock_tags')
    .select('watchlist_stock_id, tag_id, watchlist_tags(id, name)')
    .eq('user_id', userId)
    .in('watchlist_stock_id', stockIds)

  if (error) throw new Error(error.message)

  for (const row of (data ?? []) as StockTagRow[]) {
    const tag = Array.isArray(row.watchlist_tags) ? row.watchlist_tags[0] : row.watchlist_tags
    if (!tag) continue
    const list = map.get(row.watchlist_stock_id) ?? []
    list.push({ id: tag.id, name: tag.name })
    map.set(row.watchlist_stock_id, list)
  }

  for (const [stockId, tags] of map) {
    map.set(
      stockId,
      [...tags].sort((a, b) => a.name.localeCompare(b.name)),
    )
  }

  return map
}

export async function replaceStockTags(
  supabase: Supabase,
  userId: string,
  stockId: string,
  rawTagNames: string[],
): Promise<WatchlistTagRef[]> {
  const validated = validateWatchlistTagList(rawTagNames)
  if (!validated.ok) throw new TagValidationError(validated.error)

  const tagNames = validated.names

  const { count: userTagCount, error: countError } = await supabase
    .from('watchlist_tags')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)

  if (countError) throw new Error(countError.message)

  const { data: existingLinks, error: linksError } = await supabase
    .from('watchlist_stock_tags')
    .select('tag_id')
    .eq('user_id', userId)
    .eq('watchlist_stock_id', stockId)

  if (linksError) throw new Error(linksError.message)

  const existingTagIds = new Set((existingLinks ?? []).map((r) => r.tag_id as string))

  const keysNeeded = tagNames.map(normalizeWatchlistTagKey)
  const { data: existingTags, error: tagsError } = await supabase
    .from('watchlist_tags')
    .select('id, name, name_normalized')
    .eq('user_id', userId)
    .in('name_normalized', keysNeeded.length ? keysNeeded : ['__none__'])

  if (tagsError) throw new Error(tagsError.message)

  const tagByKey = new Map((existingTags ?? []).map((t) => [t.name_normalized as string, t as TagRow]))
  const newKeys = keysNeeded.filter((k) => !tagByKey.has(k))

  if ((userTagCount ?? 0) + newKeys.length > WATCHLIST_MAX_TAGS_PER_USER) {
    throw new TagValidationError(`At most ${WATCHLIST_MAX_TAGS_PER_USER} unique tags per account`)
  }

  for (let i = 0; i < tagNames.length; i++) {
    const key = keysNeeded[i]
    if (tagByKey.has(key)) continue

    const { data: inserted, error: insertError } = await supabase
      .from('watchlist_tags')
      .insert({
        user_id: userId,
        name: tagNames[i],
        name_normalized: key,
      })
      .select('id, name, name_normalized')
      .single()

    if (insertError) {
      if (insertError.code === '23505') {
        const { data: retry } = await supabase
          .from('watchlist_tags')
          .select('id, name, name_normalized')
          .eq('user_id', userId)
          .eq('name_normalized', key)
          .maybeSingle()
        if (retry) tagByKey.set(key, retry as TagRow)
        continue
      }
      throw new Error(insertError.message)
    }

    tagByKey.set(key, inserted as TagRow)
  }

  const resolvedTags: WatchlistTagRef[] = tagNames.map((name) => {
    const row = tagByKey.get(normalizeWatchlistTagKey(name))!
    return { id: row.id, name: row.name }
  })

  const resolvedIds = new Set(resolvedTags.map((t) => t.id))

  const toRemove = [...existingTagIds].filter((id) => !resolvedIds.has(id))
  if (toRemove.length) {
    const { error: deleteLinksError } = await supabase
      .from('watchlist_stock_tags')
      .delete()
      .eq('user_id', userId)
      .eq('watchlist_stock_id', stockId)
      .in('tag_id', toRemove)

    if (deleteLinksError) throw new Error(deleteLinksError.message)
  }

  const toAdd = resolvedTags.filter((t) => !existingTagIds.has(t.id))
  if (toAdd.length) {
    const { error: insertLinksError } = await supabase
      .from('watchlist_stock_tags')
      .insert(
        toAdd.map((t) => ({
          user_id: userId,
          watchlist_stock_id: stockId,
          tag_id: t.id,
        })),
      )

    if (insertLinksError) throw new Error(insertLinksError.message)
  }

  return resolvedTags
}

export class TagValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TagValidationError'
  }
}
