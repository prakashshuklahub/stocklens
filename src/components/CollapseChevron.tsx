import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

type CollapseChevronProps = {
  open: boolean
  className?: string
}

/** Larger collapse chevron — Picks + Trending section headers only. */
export default function CollapseChevron({ open, className }: CollapseChevronProps) {
  return (
    <ChevronDown
      aria-hidden="true"
      className={cn(
        'w-5 h-5 text-zinc-500 shrink-0 transition-transform duration-200',
        open && 'rotate-180',
        className,
      )}
    />
  )
}
