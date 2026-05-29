import { AlertTriangle, Briefcase, TrendingUp } from 'lucide-react'

type Props = {
  company_blurb?: string | null
  thesis?: string | null
  main_risk?: string | null
  narrative_source?: 'llm' | 'mechanical'
  llm_enabled?: boolean
  className?: string
  /** Trending cards: one combined block at half length. Picks keep three sections. */
  variant?: 'sections' | 'combined'
}

function truncateToWordRatio(text: string, ratio: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return ''
  const limit = Math.max(8, Math.ceil(words.length * ratio))
  if (limit >= words.length) return text.trim()
  return `${words.slice(0, limit).join(' ').replace(/[,;]$/, '')}…`
}

function combineNarrativeText(
  company_blurb: string | null | undefined,
  thesis: string | null | undefined,
  main_risk: string | null | undefined,
  wordRatio: number,
): string {
  const parts = [company_blurb, thesis, main_risk]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p))
  if (!parts.length) return ''
  return truncateToWordRatio(parts.join(' '), wordRatio)
}

export default function NarrativeSummaryBlocks({
  company_blurb,
  thesis,
  main_risk,
  narrative_source,
  llm_enabled,
  className,
  variant = 'sections',
}: Props) {
  if (!company_blurb && !thesis && !main_risk) return null

  const footer = (narrative_source || llm_enabled != null) && (
    <p className="type-micro text-muted pt-0.5">
      {narrative_source === 'llm'
        ? 'Summary written by AI · prices and ratings from public data'
        : llm_enabled
          ? 'Signal-based summary · AI summary loading…'
          : 'Summary from the signals above · prices and ratings from public data'}
    </p>
  )

  if (variant === 'combined') {
    const combined = combineNarrativeText(company_blurb, thesis, main_risk, 0.5)
    if (!combined) return null

    return (
      <div className={className ?? 'mt-2.5'}>
        <div className="flex items-center gap-1.5 mb-1.5">
          <TrendingUp className="w-3.5 h-3.5 text-orange-400 shrink-0" aria-hidden="true" />
          <p className="type-meta font-bold text-orange-400 uppercase tracking-wide">Why it&apos;s trending</p>
        </div>
        <p className="text-sm text-zinc-300 leading-relaxed [text-wrap:pretty]">{combined}</p>
        {footer}
      </div>
    )
  }

  return (
    <div className={className ?? 'space-y-3 mt-2.5'}>
      {company_blurb && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Briefcase className="w-3.5 h-3.5 text-blue-400 shrink-0" aria-hidden="true" />
            <p className="type-meta font-bold text-blue-400 uppercase tracking-wide">What they do</p>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed [text-wrap:pretty]">{company_blurb}</p>
        </div>
      )}

      {thesis && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
            <p className="type-meta font-bold text-emerald-400 uppercase tracking-wide">Why it looks good</p>
          </div>
          <p className="text-sm text-zinc-200 leading-relaxed [text-wrap:pretty]">{thesis}</p>
        </div>
      )}

      {main_risk && (
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-yellow-400 shrink-0" aria-hidden="true" />
            <p className="type-meta font-bold text-yellow-400 uppercase tracking-wide">Main thing to watch</p>
          </div>
          <p className="text-sm text-zinc-300 leading-relaxed [text-wrap:pretty]">{main_risk}</p>
        </div>
      )}

      {footer}
    </div>
  )
}
