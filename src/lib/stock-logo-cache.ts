import { fetchLogoFromWeb } from '@/lib/stock-logo'
import type { createServerClient } from '@/lib/supabase'

type Supabase = ReturnType<typeof createServerClient>

export type CachedLogo =
  | { status: 'ok'; content_type: string; logo_base64: string }
  | { status: 'unavailable' }

type LogoRow = {
  ticker: string
  content_type: string | null
  logo_base64: string | null
  status: 'ok' | 'unavailable'
}

export async function loadCachedLogo(
  supabase: Supabase,
  ticker: string,
): Promise<CachedLogo | null> {
  const sym = ticker.toUpperCase()
  const { data, error } = await supabase
    .from('stock_logos')
    .select('content_type, logo_base64, status')
    .eq('ticker', sym)
    .maybeSingle()

  if (error) {
    if (error.message.includes('stock_logos') || error.message.includes('PGRST205')) {
      return null
    }
    console.warn('[stock-logo] SELECT failed:', error.message)
    return null
  }

  if (!data) return null
  const row = data as LogoRow
  if (row.status === 'unavailable') return { status: 'unavailable' }
  if (row.logo_base64 && row.content_type) {
    return {
      status: 'ok',
      content_type: row.content_type,
      logo_base64: row.logo_base64,
    }
  }
  return null
}

async function persistLogo(
  supabase: Supabase,
  ticker: string,
  payload: CachedLogo,
): Promise<void> {
  const sym = ticker.toUpperCase()
  const row =
    payload.status === 'ok'
      ? {
          ticker: sym,
          status: 'ok' as const,
          content_type: payload.content_type,
          logo_base64: payload.logo_base64,
        }
      : {
          ticker: sym,
          status: 'unavailable' as const,
          content_type: 'image/png',
          logo_base64: null,
        }

  const { error } = await supabase.from('stock_logos').upsert(row)
  if (error) {
    console.warn('[stock-logo] upsert failed:', error.message)
  }
}

/** Read DB cache or fetch from web once and store permanently. */
export async function resolveStockLogo(
  supabase: Supabase,
  ticker: string,
): Promise<CachedLogo | null> {
  const cached = await loadCachedLogo(supabase, ticker)
  if (cached) return cached

  const fetched = await fetchLogoFromWeb(ticker)
  const payload: CachedLogo = fetched
    ? {
        status: 'ok',
        content_type: fetched.content_type,
        logo_base64: fetched.logo_base64,
      }
    : { status: 'unavailable' }

  await persistLogo(supabase, ticker, payload)
  return payload
}

/** Warm logos for many tickers (skips already cached). */
export async function ensureLogosForTickers(
  supabase: Supabase,
  tickers: string[],
  concurrency = 3,
): Promise<void> {
  const syms = [...new Set(tickers.map((t) => t.toUpperCase()))]
  if (!syms.length) return

  const { data, error } = await supabase.from('stock_logos').select('ticker').in('ticker', syms)

  if (error && !error.message.includes('stock_logos') && !error.message.includes('PGRST205')) {
    console.warn('[stock-logo] batch SELECT failed:', error.message)
    return
  }

  const have = new Set((data ?? []).map((r: { ticker: string }) => r.ticker))
  const missing = syms.filter((t) => !have.has(t))
  if (!missing.length) return

  let i = 0
  async function worker() {
    while (i < missing.length) {
      const sym = missing[i++]
      await resolveStockLogo(supabase, sym)
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, missing.length) }, () => worker()),
  )
}
