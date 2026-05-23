import type { MetadataRoute } from 'next'
import { BRAND_COLORS } from '@/lib/brand-icon'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Stocklens',
    short_name: 'Stocklens',
    description: 'Track the stocks you truly believe in.',
    display: 'standalone',
    background_color: BRAND_COLORS.background,
    theme_color: BRAND_COLORS.background,
    start_url: '/',
    scope: '/',
    orientation: 'portrait',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
