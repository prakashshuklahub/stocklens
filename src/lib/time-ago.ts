/** Shared relative-time formatter (pure — safe to call after mount). */
export function formatTimeAgo(iso: string, nowMs = Date.now()): string {
  const s = Math.floor((nowMs - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.max(0, s)}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  return `${Math.floor(days / 7)}w ago`
}
