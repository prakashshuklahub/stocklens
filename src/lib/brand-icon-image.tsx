import { BRAND_COLORS } from '@/lib/brand-icon'

type BrandIconImageProps = {
  size: number
  maskable?: boolean
}

export function BrandIconImage({ size, maskable = false }: BrandIconImageProps) {
  const pad = maskable ? size * 0.2 : size * 0.128
  const tile = size - pad * 2
  const radius = tile * 0.22
  const iconSize = tile * 0.5
  const stroke = Math.max(2.5, size * 0.012)
  const border = Math.max(2, size * 0.004)

  return (
    <div
      style={{
        width: size,
        height: size,
        background: BRAND_COLORS.background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: tile,
          height: tile,
          borderRadius: radius,
          background: BRAND_COLORS.tileFill,
          border: `${border}px solid ${BRAND_COLORS.tileBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <svg width={iconSize} height={iconSize} viewBox="0 0 24 24" fill="none">
          <polyline
            points="22 7 13.5 15.5 8.5 10.5 2 17"
            stroke={BRAND_COLORS.icon}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <polyline
            points="16 7 22 7 22 13"
            stroke={BRAND_COLORS.icon}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  )
}
