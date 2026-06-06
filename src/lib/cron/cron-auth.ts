import { env } from '@/lib/env'
import type { NextRequest } from 'next/server'

/** Bearer check for /api/cron/* routes (Vercel cron + manual scripts). */
export function cronAuthorized(req: NextRequest): boolean {
  const secret = env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}
