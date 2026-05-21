// Yahoo Finance quoteSummary requires a session cookie + crumb.
// Used for analyst price targets (financialData module).
// All quoteSummary calls are queued to avoid 429s when the watchlist loads many tickers.

const YAHOO_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const SESSION_TTL_MS = 30 * 60 * 1000
const QUOTE_SUMMARY_GAP_MS = 400
const CRUMB_COOLDOWN_MS = 90 * 1000

const RETRYABLE_STATUS = new Set([429, 503])

type YahooSession = { cookie: string; crumb: string; expiresAt: number }

let sessionCache: YahooSession | null = null
let sessionInflight: Promise<YahooSession> | null = null
let crumbBlockedUntil = 0
let yahooQueue: Promise<unknown> = Promise.resolve()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function collectCookies(res: Response): string {
  const getSetCookie = res.headers.getSetCookie
  if (typeof getSetCookie === 'function') {
    const parts = getSetCookie.call(res.headers)
    if (parts.length) return parts.map((c) => c.split(';')[0]).join('; ')
  }
  const single = res.headers.get('set-cookie')
  if (!single) return ''
  return single
    .split(/,(?=\s*[^;,]+=)/)
    .map((c) => c.split(';')[0].trim())
    .join('; ')
}

function isValidCrumb(crumb: string): boolean {
  return (
    crumb.length > 0 &&
    crumb.length < 64 &&
    !/\s/.test(crumb) &&
    !/too many/i.test(crumb)
  )
}

/** Serialize Yahoo quoteSummary work (one at a time + gap). */
function enqueueYahoo<T>(fn: () => Promise<T>): Promise<T> {
  const run = yahooQueue.then(async () => {
    await sleep(QUOTE_SUMMARY_GAP_MS)
    return fn()
  })
  yahooQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export function invalidateYahooSession(): void {
  sessionCache = null
  sessionInflight = null
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 5): Promise<Response> {
  let last: Response | null = null
  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, init)
    last = res
    if (!RETRYABLE_STATUS.has(res.status) || i === attempts - 1) return res
    await sleep(1500 * (i + 1))
  }
  return last!
}

async function readCrumb(res: Response): Promise<string> {
  const text = (await res.text()).trim()
  if (!isValidCrumb(text)) {
    if (res.status === 429 || /too many/i.test(text)) {
      crumbBlockedUntil = Date.now() + CRUMB_COOLDOWN_MS
    }
    throw new Error(`yahoo crumb invalid: ${text.slice(0, 24)}`)
  }
  return text
}

async function createYahooSession(): Promise<YahooSession> {
  if (Date.now() < crumbBlockedUntil) {
    throw new Error('yahoo session: rate limited')
  }

  const boot = await fetchWithRetry('https://fc.yahoo.com', {
    headers: { 'User-Agent': YAHOO_USER_AGENT },
    redirect: 'follow',
    cache: 'no-store',
  })
  const cookie = collectCookies(boot)
  if (!cookie) throw new Error('yahoo session: no cookies')

  const crumbRes = await fetchWithRetry('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': YAHOO_USER_AGENT, Cookie: cookie },
    cache: 'no-store',
  })
  const crumb = await readCrumb(crumbRes)

  return { cookie, crumb, expiresAt: Date.now() + SESSION_TTL_MS }
}

export async function getYahooSession(): Promise<{ cookie: string; crumb: string }> {
  if (sessionCache && Date.now() < sessionCache.expiresAt) {
    return sessionCache
  }

  if (!sessionInflight) {
    sessionInflight = createYahooSession()
      .then((session) => {
        sessionCache = session
        return session
      })
      .finally(() => {
        sessionInflight = null
      })
  }

  return sessionInflight
}

/** Yahoo returns numbers as raw values or { raw, fmt } objects. */
export function yahooRawNumber(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'object' && value !== null && 'raw' in value) {
    const raw = (value as { raw?: unknown }).raw
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null
  }
  return null
}

export type PriceTargetFields = {
  target_mean: number | null
  target_high: number | null
  target_low: number | null
}

function parseFinancialDataTargets(fd: Record<string, unknown> | undefined): PriceTargetFields | null {
  if (!fd) return null
  const target_mean = yahooRawNumber(fd.targetMeanPrice)
  const target_high = yahooRawNumber(fd.targetHighPrice)
  const target_low = yahooRawNumber(fd.targetLowPrice)
  if (target_mean == null || target_mean <= 0) return null
  return { target_mean, target_high, target_low }
}

function isYahooAuthError(data: unknown): boolean {
  const code = (data as { finance?: { error?: { code?: string } } })?.finance?.error?.code
  return code === 'Unauthorized'
}

async function fetchYahooPriceTargetOnce(ticker: string): Promise<PriceTargetFields | null> {
  const sym = ticker.toUpperCase()
  const { cookie, crumb } = await getYahooSession()
  const url =
    `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${sym}` +
    `?modules=financialData&crumb=${encodeURIComponent(crumb)}`
  const res = await fetchWithRetry(url, {
    headers: { 'User-Agent': YAHOO_USER_AGENT, Cookie: cookie },
    cache: 'no-store',
  })
  if (!res.ok) {
    if (res.status === 429) invalidateYahooSession()
    return null
  }
  let data: unknown
  try {
    data = await res.json()
  } catch {
    return null
  }
  if (isYahooAuthError(data)) {
    invalidateYahooSession()
    return null
  }
  const summary = data as {
    quoteSummary?: { result?: Array<{ financialData?: Record<string, unknown> }> }
  }
  const fd = summary.quoteSummary?.result?.[0]?.financialData
  return parseFinancialDataTargets(fd)
}

/** Analyst consensus price targets from Yahoo financialData (free, no API key). */
export async function fetchYahooPriceTarget(ticker: string): Promise<PriceTargetFields | null> {
  return enqueueYahoo(async () => {
    try {
      let result = await fetchYahooPriceTargetOnce(ticker)
      if (result) return result
      invalidateYahooSession()
      result = await fetchYahooPriceTargetOnce(ticker)
      return result
    } catch (err) {
      console.warn(`[yahoo] price target failed for ${ticker}:`, err instanceof Error ? err.message : err)
      return null
    }
  })
}
