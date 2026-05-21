// Fetch company logo bytes from public CDNs / Finnhub (one-time before DB cache).

import { env } from '@/lib/env'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const MIN_BYTES = 200

export type LogoPayload = {
  content_type: string
  logo_base64: string
}

function finnhubStaticUrl(ticker: string): string {
  return `https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/${ticker}.png`
}

function fmpLogoUrl(ticker: string): string {
  return `https://financialmodelingprep.com/image-stock/${ticker}.png`
}

async function fetchImageBytes(url: string): Promise<LogoPayload | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      cache: 'force-cache',
    })
    if (!res.ok) return null
    const contentType = (res.headers.get('content-type') ?? '').split(';')[0]?.trim()
    if (!contentType?.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length < MIN_BYTES) return null
    return {
      content_type: contentType,
      logo_base64: buf.toString('base64'),
    }
  } catch {
    return null
  }
}

async function fetchFinnhubProfileLogo(ticker: string): Promise<LogoPayload | null> {
  if (!env.FINNHUB_API_KEY) return null
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${ticker}&token=${env.FINNHUB_API_KEY}`,
      { cache: 'force-cache' },
    )
    if (!res.ok) return null
    const data = (await res.json()) as { logo?: string }
    const logoUrl = typeof data.logo === 'string' ? data.logo.trim() : ''
    if (!logoUrl.startsWith('http')) return null
    return fetchImageBytes(logoUrl)
  } catch {
    return null
  }
}

/** Try Finnhub CDN → FMP image → Finnhub profile logo URL. */
export async function fetchLogoFromWeb(ticker: string): Promise<LogoPayload | null> {
  const sym = ticker.toUpperCase()
  const sources = [
    () => fetchImageBytes(finnhubStaticUrl(sym)),
    () => fetchImageBytes(fmpLogoUrl(sym)),
    () => fetchFinnhubProfileLogo(sym),
  ]
  for (const load of sources) {
    const payload = await load()
    if (payload) return payload
  }
  return null
}
