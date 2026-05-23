/** Keep last live snapshots when the API skips price fetches outside market hours. */

type WithTicker = { ticker: string; snapshot?: unknown }

export function createMarketAwareFetcher<T extends WithTicker>() {
  let lastWithSnapshots: T[] | null = null

  return async (url: string): Promise<T[]> => {
    const res = await fetch(url, { cache: 'no-store' })
    const data = (await res.json()) as T[]
    const marketOpen = res.headers.get('X-Market-Open') === '1'

    if (marketOpen) {
      lastWithSnapshots = data
      return data
    }

    if (!lastWithSnapshots?.length) return data

    return data.map((row) => {
      const prev = lastWithSnapshots!.find((s) => s.ticker === row.ticker)
      return prev?.snapshot != null ? { ...row, snapshot: prev.snapshot } : row
    })
  }
}
