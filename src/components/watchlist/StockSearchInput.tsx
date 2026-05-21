'use client'

import { useState, useRef, useEffect, useCallback, useId } from 'react'
import { Search, X, Loader2 } from 'lucide-react'
import StockLogo from '@/components/StockLogo'
import { cn } from '@/lib/utils'

const SECTOR_COLORS: Record<string, string> = {
  Technology: 'text-blue-400',
  Healthcare: 'text-emerald-400',
  Financials: 'text-yellow-400',
  'Consumer Discretionary': 'text-orange-400',
  'Consumer Staples': 'text-amber-400',
  Energy: 'text-red-400',
  Industrials: 'text-slate-400',
  Materials: 'text-lime-400',
  Utilities: 'text-teal-400',
  'Real Estate': 'text-purple-400',
  'Communication Services': 'text-pink-400',
}

export interface StockResult {
  ticker: string
  company_name: string
  sector: string | null
  price: number | null
  change_pct: number | null
}

interface Props {
  onSelect: (result: StockResult) => void
  disabled?: boolean
}

export default function StockSearchInput({ onSelect, disabled }: Props) {
  const inputId = useId()
  const listboxId = useId()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StockResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (q: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/watchlist/search?q=${encodeURIComponent(q)}`)
      if (res.ok) setResults(await res.json())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!query.trim()) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(() => { setOpen(true); search(query.trim()) }, 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, search])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function keyHandler(e: KeyboardEvent) {
      if (e.key === 'Escape') { setOpen(false); setQuery('') }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [])

  function handleSelect(r: StockResult) {
    onSelect(r)
    setQuery('')
    setResults([])
    setOpen(false)
  }

  function fmtPrice(p: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(p)
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <label htmlFor={inputId} className="sr-only">Search stocks by ticker or company name</label>
      <div className="relative">
        <Search
          className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none"
          aria-hidden="true"
        />
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && results.length > 0}
          aria-controls={listboxId}
          aria-label="Search stocks by ticker or company name"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search ticker or company…"
          disabled={disabled}
          onFocus={() => results.length > 0 && setOpen(true)}
          className="w-full card-surface pl-11 pr-10 py-4 text-base text-white placeholder:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 transition-all disabled:opacity-40 [touch-action:manipulation]"
        />
        {loading && (
          <Loader2
            className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 animate-spin"
            aria-hidden="true"
          />
        )}
        {query && !loading && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => { setQuery(''); setResults([]); setOpen(false) }}
            className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-zinc-500 hover:text-zinc-300 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-500 rounded-xl [touch-action:manipulation]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label="Stock search results"
          className="absolute z-50 mt-1.5 w-full bg-zinc-900 shadow-2xl shadow-black/50 rounded-2xl overflow-hidden max-h-72 overflow-y-auto"
        >
          {results.map((r) => (
            <li key={r.ticker} role="option" aria-selected={false}>
              <button
                type="button"
                onClick={() => handleSelect(r)}
                aria-label={`Add ${r.ticker} – ${r.company_name}${r.price != null ? `, ${fmtPrice(r.price)}` : ''}`}
                className="w-full flex items-center px-4 py-3.5 active:bg-zinc-800 transition-colors text-left gap-3 border-b border-white/[0.04] last:border-0 focus-visible:outline-none focus-visible:bg-zinc-800 [touch-action:manipulation]"
              >
                <StockLogo ticker={r.ticker} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-white text-sm font-mono" translate="no">{r.ticker}</span>
                    {r.sector && (
                      <span className={cn('text-xs font-medium', SECTOR_COLORS[r.sector] ?? 'text-zinc-500')}>
                        {r.sector}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 truncate mt-0.5">{r.company_name}</p>
                </div>
                {r.price != null && (
                  <div className="text-right shrink-0" aria-hidden="true">
                    <p className="text-sm font-semibold text-white tabular-nums">{fmtPrice(r.price)}</p>
                    {r.change_pct != null && (
                      <p className={cn('text-xs tabular-nums', r.change_pct >= 0 ? 'text-emerald-400' : 'text-red-400')}>
                        {r.change_pct >= 0 ? '+' : ''}{r.change_pct.toFixed(2)}%
                      </p>
                    )}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && !loading && query.length > 1 && results.length === 0 && (
        <div
          className="absolute z-50 mt-1.5 w-full bg-zinc-900 shadow-2xl shadow-black/50 rounded-2xl px-4 py-4 text-center text-sm text-zinc-600"
          aria-live="polite"
        >
          No results for &ldquo;{query}&rdquo;
        </div>
      )}
    </div>
  )
}
