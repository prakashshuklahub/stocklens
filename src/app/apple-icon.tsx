import { ImageResponse } from 'next/og'
import { BrandIconImage } from '@/lib/brand-icon-image'

export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
  return new ImageResponse(<BrandIconImage size={180} />, { ...size })
}
