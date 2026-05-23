/** Where current price sits in the 52-week low–high range (shared watchlist + picks). */

export default function Week52Range({
  high,
  low,
  current,
}: {
  high: number | null
  low: number | null
  current: number | null
}) {
  if (high == null || low == null || current == null || high === low) return null
  const pct = Math.max(0, Math.min(100, ((current - low) / (high - low)) * 100))
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="type-meta text-zinc-500 font-medium">52-week range</span>
        <span className="type-micro text-zinc-600">dot = today</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="type-meta text-zinc-500 tabular-nums shrink-0">${low.toFixed(0)}</span>
        <div className="flex-1 h-1.5 rounded-full bg-zinc-700/50 relative">
          <div
            className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-sm shadow-black/30"
            style={{ left: `calc(${pct}% - 5px)` }}
            aria-label="Current price in 52-week range"
          />
        </div>
        <span className="type-meta text-zinc-500 tabular-nums shrink-0">${high.toFixed(0)}</span>
      </div>
    </div>
  )
}
