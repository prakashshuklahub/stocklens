'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import {
  dedupeWatchlistTagNames,
  normalizeWatchlistTagKey,
  validateWatchlistTagName,
  WATCHLIST_MAX_TAGS_PER_STOCK,
  WATCHLIST_TAG_HINTS,
  type WatchlistTagRef,
} from '@/lib/watchlist-tags'
import { cn } from '@/lib/utils'

type Props = {
  open: boolean
  ticker: string
  initialTags: WatchlistTagRef[]
  suggestions: string[]
  onClose: () => void
  onSave: (tags: string[]) => Promise<void>
}

export default function WatchlistTagPicker({
  open,
  ticker,
  initialTags,
  suggestions,
  onClose,
  onSave,
}: Props) {
  const [draft, setDraft] = useState<string[]>([])
  const [input, setInput] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft(initialTags.map((t) => t.name))
      setInput('')
      setError('')
    }
  }, [open, initialTags])

  const draftKeys = useMemo(() => new Set(draft.map(normalizeWatchlistTagKey)), [draft])

  const availableSuggestions = useMemo(() => {
    const merged = [...WATCHLIST_TAG_HINTS, ...suggestions]
    return dedupeWatchlistTagNames(merged).filter((name) => !draftKeys.has(normalizeWatchlistTagKey(name)))
  }, [suggestions, draftKeys])

  const addTag = useCallback(
    (raw: string) => {
      setError('')
      const parsed = validateWatchlistTagName(raw)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      const key = normalizeWatchlistTagKey(parsed.name)
      if (draftKeys.has(key)) {
        setInput('')
        return
      }
      if (draft.length >= WATCHLIST_MAX_TAGS_PER_STOCK) {
        setError(`At most ${WATCHLIST_MAX_TAGS_PER_STOCK} tags per stock`)
        return
      }
      setDraft((prev) => [...prev, parsed.name].sort((a, b) => a.localeCompare(b)))
      setInput('')
    },
    [draft.length, draftKeys],
  )

  const removeTag = useCallback((name: string) => {
    const key = normalizeWatchlistTagKey(name)
    setDraft((prev) => prev.filter((t) => normalizeWatchlistTagKey(t) !== key))
    setError('')
  }, [])

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await onSave(draft)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save tags')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <button
        type="button"
        aria-label="Close tag editor"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="watchlist-tag-picker-title"
        className="relative w-full max-w-md bg-zinc-900 border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl shadow-black/60 p-5 pb-8 sm:pb-5 max-h-[85vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 id="watchlist-tag-picker-title" className="text-base font-semibold text-white">
              Tags for <span translate="no">{ticker}</span>
            </h2>
            <p className="type-meta text-zinc-500 mt-0.5">
              Group similar stocks — e.g. long term, short term
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-xl text-zinc-500 active:bg-zinc-800 [touch-action:manipulation]"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {draft.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 mb-3">
            {draft.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => removeTag(name)}
                className="watchlist-chip inline-flex items-center gap-1 bg-violet-500/15 text-violet-300 active:bg-violet-500/25 [touch-action:manipulation]"
              >
                {name}
                <X className="w-3 h-3 opacity-70" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <p className="type-meta text-zinc-600 mb-3">No tags yet</p>
        )}

        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addTag(input)
              }
            }}
            placeholder="Add a tag…"
            maxLength={24}
            className="flex-1 min-w-0 rounded-xl bg-zinc-800 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-violet-500/40"
          />
          <button
            type="button"
            disabled={!input.trim() || saving}
            onClick={() => addTag(input)}
            className="shrink-0 px-4 py-2.5 rounded-xl text-sm font-semibold bg-violet-500/20 text-violet-300 active:bg-violet-500/30 disabled:opacity-40 [touch-action:manipulation]"
          >
            Add
          </button>
        </div>

        {availableSuggestions.length > 0 && (
          <div className="mb-4">
            <p className="type-micro font-bold text-zinc-600 uppercase tracking-wide mb-2">Suggestions</p>
            <div className="flex flex-wrap gap-1.5">
              {availableSuggestions.slice(0, 12).map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => addTag(name)}
                  disabled={draft.length >= WATCHLIST_MAX_TAGS_PER_STOCK}
                  className="watchlist-chip bg-zinc-800 text-zinc-400 active:bg-zinc-700 disabled:opacity-40 [touch-action:manipulation]"
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        )}

        {error && (
          <p className="type-meta text-red-400 mb-3" role="alert">
            {error}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 min-h-[44px] rounded-xl bg-zinc-800 text-zinc-300 text-sm font-medium active:bg-zinc-700 disabled:opacity-50 [touch-action:manipulation]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className={cn(
              'flex-1 min-h-[44px] rounded-xl text-sm font-semibold text-white',
              'bg-violet-600 active:bg-violet-500 disabled:opacity-50 [touch-action:manipulation]',
            )}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
