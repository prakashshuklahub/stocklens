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
  className,
}: {
  ticker: string
  px: number
  className?: string
}) {
  const letter = ticker.charAt(0) || '?'
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex items-center justify-center rounded-xl bg-zinc-800 text-zinc-400 font-bold shrink-0',
        className,
      )}
      style={{ width: px, height: px, fontSize: Math.round(px * 0.38) }}
    >
      {letter}
    </span>
  )
}

export default function StockLogo({
  ticker,
  size = 'md',
  className,
}: {
  ticker: string
  size?: keyof typeof SIZES
  className?: string
}) {
  const sym = ticker.toUpperCase()
  const px = SIZES[size]
  const [failed, setFailed] = useState(false)

  if (failed) {
    return <TickerFallback ticker={sym} px={px} className={className} />
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- served from our DB cache API
    <img
      src={`/api/stock-logo/${encodeURIComponent(sym)}`}
      alt=""
      width={px}
      height={px}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={cn(
        'rounded-xl bg-zinc-800 object-contain shrink-0 border border-white/[0.06]',
        className,
      )}
    />
  )
}
