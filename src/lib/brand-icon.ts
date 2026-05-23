export const BRAND_COLORS = {
  background: '#09090b',
  icon: '#60a5fa',
  tileFill: 'rgba(59,130,246,0.12)',
  tileBorder: 'rgba(59,130,246,0.2)',
} as const

/** Lucide TrendingUp polylines in a 24×24 viewBox. */
const TRENDING_UP_POLYLINES = [
  '22 7 13.5 15.5 8.5 10.5 2 17',
  '16 7 22 7 22 13',
] as const

export function brandIconSvg(size: number, maskable = false): string {
  const pad = maskable ? size * 0.2 : size * 0.128
  const tile = size - pad * 2
  const radius = tile * 0.22
  const iconSize = tile * 0.5
  const stroke = Math.max(2, size * 0.012)
  const border = Math.max(2, size * 0.004)
  const cx = size / 2
  const cy = size / 2
  const iconX = cx - iconSize / 2
  const iconY = cy - iconSize / 2
  const scale = iconSize / 24

  const polylines = TRENDING_UP_POLYLINES.map(
    (points) =>
      `<polyline points="${points}" fill="none" stroke="${BRAND_COLORS.icon}" stroke-width="${stroke / scale}" stroke-linecap="round" stroke-linejoin="round" transform="translate(${iconX} ${iconY}) scale(${scale})"/>`,
  ).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BRAND_COLORS.background}"/>
  <rect x="${pad}" y="${pad}" width="${tile}" height="${tile}" rx="${radius}" fill="${BRAND_COLORS.tileFill}" stroke="${BRAND_COLORS.tileBorder}" stroke-width="${border}"/>
  ${polylines}
</svg>`
}
