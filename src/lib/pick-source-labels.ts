import type { PickSourceTag } from '@/types'

/** User-facing source labels on pick cards (internal tag stays `discovery`). */
export const PICK_SOURCE_LABELS: Record<PickSourceTag, string> = {
  watchlist: 'Watchlist',
  portfolio: 'Portfolio',
  both: 'Watchlist · Portfolio',
  discovery: 'Movers',
}

const PICK_SOURCE_COLORS: Record<PickSourceTag, { surface: string; border: string }> = {
  discovery: {
    surface: 'bg-orange-500/15 text-orange-300',
    border: 'border-orange-500/30 shadow-[0_0_0_1px_rgb(249_115_22/0.2)]',
  },
  portfolio: {
    surface: 'bg-blue-500/15 text-blue-300',
    border: 'border-blue-500/30 shadow-[0_0_0_1px_rgb(59_130_246/0.2)]',
  },
  both: {
    surface: 'bg-violet-500/15 text-violet-300',
    border: 'border-violet-500/30 shadow-[0_0_0_1px_rgb(139_92_246/0.2)]',
  },
  watchlist: {
    surface: 'bg-zinc-800 text-zinc-400',
    border: 'border-white/10 shadow-[0_0_0_1px_rgb(255_255_255/0.06)]',
  },
}

export function pickSourceLabel(source: PickSourceTag): string {
  return PICK_SOURCE_LABELS[source]
}

export function pickSourceStyles(source: PickSourceTag): string {
  return PICK_SOURCE_COLORS[source].surface
}

export type PickSourceFilter = 'all' | 'movers' | 'watchlist' | 'portfolio'

const PICK_SOURCE_FILTER_TAG: Record<Exclude<PickSourceFilter, 'all'>, PickSourceTag> = {
  movers: 'discovery',
  watchlist: 'watchlist',
  portfolio: 'portfolio',
}

/** Active filter chip classes — same palette as pick card source badges. */
export function pickSourceFilterActiveClass(filter: PickSourceFilter): string | undefined {
  if (filter === 'all') return undefined
  const colors = PICK_SOURCE_COLORS[PICK_SOURCE_FILTER_TAG[filter]]
  return `${colors.surface} ${colors.border}`
}

export function pickMatchesSourceFilter(source: PickSourceTag, filter: PickSourceFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'movers':
      return source === 'discovery'
    case 'watchlist':
      return source === 'watchlist' || source === 'both'
    case 'portfolio':
      return source === 'portfolio' || source === 'both'
  }
}
