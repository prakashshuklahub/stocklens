import { sendWhatsAppBriefingsInDb } from '@/lib/cron/send-whatsapp-briefings'
import { env } from '@/lib/env'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'

function authorized(req: NextRequest): boolean {
  const secret = env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

/** Send WhatsApp daily portfolio briefings — Mon–Fri 10:30 AM ET (1h after US open). */
export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createServerClient()

  try {
    const result = await sendWhatsAppBriefingsInDb(supabase)
    console.info(
      `[cron/send-whatsapp-briefings] sent=${result.sent} failed=${result.failed} eligible=${result.users_eligible}`,
    )
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/send-whatsapp-briefings] failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Send failed' },
      { status: 500 },
    )
  }
}

export const maxDuration = 120
