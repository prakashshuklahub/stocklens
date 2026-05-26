'use client'

import { useEffect, useState } from 'react'
import { formatTimeAgo } from '@/lib/time-ago'

/** Renders relative time only after mount to avoid SSR/client clock drift. */
export default function ClientTimeAgo({
  iso,
  className,
}: {
  iso: string
  className?: string
}) {
  const [label, setLabel] = useState<string | null>(null)

  useEffect(() => {
    setLabel(formatTimeAgo(iso))
    const id = window.setInterval(() => setLabel(formatTimeAgo(iso)), 60_000)
    return () => window.clearInterval(id)
  }, [iso])

  return (
    <span className={className} suppressHydrationWarning>
      {label ?? '…'}
    </span>
  )
}
