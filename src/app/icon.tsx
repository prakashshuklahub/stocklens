import { ImageResponse } from 'next/og'
import { BrandIconImage } from '@/lib/brand-icon-image'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(<BrandIconImage size={32} />, { ...size })
}
