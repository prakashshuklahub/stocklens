import { cn } from '@/lib/utils'

function Mini({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'zinc' | 'red' }) {
  const styles = {
    emerald: 'bg-emerald-500/10 text-emerald-300',
    zinc: 'bg-zinc-800 text-zinc-300',
    red: 'bg-red-500/10 text-red-300',
  }[tone]
  return (
    <div className={cn('flex-1 rounded-xl py-2 text-center', styles)}>
      <p className="text-base font-bold tabular-nums leading-tight">{value}</p>
      <p className="text-[10px] uppercase tracking-wide opacity-80">{label}</p>
    </div>
  )
}

export default function AnalystMiniGrid({
  buy,
  hold,
  sell,
  total,
  loading = false,
}: {
  buy: number | null
  hold: number | null
  sell: number | null
  total: number
  loading?: boolean
}) {
  if (loading && buy == null) {
    return (
      <div>
        <div className="h-3 w-36 rounded bg-zinc-700/60 animate-pulse mb-2" />
        <div className="flex gap-2">
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex-1 h-14 rounded-xl bg-zinc-800 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (buy == null) return null

  return (
    <div>
      <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wide mb-2">
        What analysts say ({total})
      </p>
      <div className="flex gap-2">
        <Mini label="Buy" value={buy} tone="emerald" />
        <Mini label="Hold" value={hold ?? 0} tone="zinc" />
        <Mini label="Sell" value={sell ?? 0} tone="red" />
      </div>
    </div>
  )
}
