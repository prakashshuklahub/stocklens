import { auth } from '@/lib/auth'
import { loadCachedLogo, resolveStockLogo } from '@/lib/stock-logo-cache'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

const IMMUTABLE = 'public, max-age=31536000, immutable' as const

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return new NextResponse(null, { status: 401 })
  }

  const { ticker } = await params
  const sym = ticker.toUpperCase().replace(/[^A-Z0-9.-]/g, '')
  if (!sym || sym.length > 12) {
    return new NextResponse(null, { status: 400 })
  }

  const supabase = createServerClient()

  let logo = await loadCachedLogo(supabase, sym)
  if (!logo) {
    logo = await resolveStockLogo(supabase, sym)
  }

  if (!logo || logo.status === 'unavailable') {
    return new NextResponse(null, { status: 404 })
  }

  const bytes = Buffer.from(logo.logo_base64, 'base64')
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      'Content-Type': logo.content_type,
      'Cache-Control': IMMUTABLE,
    },
  })
}
