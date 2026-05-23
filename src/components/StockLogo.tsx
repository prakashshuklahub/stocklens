'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

const SIZES = {
  sm: 36,
  md: 40,
  lg: 44,
} as const

function TickerFallback({
  ticker,
  px,
  inset,
  className,
}: {
  ticker: string
  px: number
  inset?: boolean
  className?: string
}) {
  const letter = ticker.charAt(0) || '?'
  const fontSize = inset ? Math.round(px * 0.32) : Math.round(px * 0.38)
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-400 font-bold shrink-0 border border-white/[0.06]',
        inset && 'p-1.5',
        className,
      )}
      style={{ width: px, height: px, fontSize }}
    >
      {letter}
    </span>
  )
}

export default function StockLogo({
  ticker,
  size = 'md',
  inset = false,
  className,
}: {
  ticker: string
  size?: keyof typeof SIZES
  /** Extra inner padding — helps wide wordmark logos fit (e.g. Picks cards). */
  inset?: boolean
  className?: string
}) {
  const sym = ticker.toUpperCase()
  const px = SIZES[size]
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <TickerFallback ticker={sym} px={px} inset={inset} className={className} />
  }

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-xl bg-zinc-800 shrink-0 border border-white/[0.06] overflow-hidden',
        inset && 'p-1.5',
        className,
      )}
      style={{ width: px, height: px }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- served from our DB cache API */}
      <img
        src={`/api/stock-logo/${encodeURIComponent(sym)}`}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className="block max-w-full max-h-full w-full h-full object-contain object-center"
      />
    </span>
  )
}
