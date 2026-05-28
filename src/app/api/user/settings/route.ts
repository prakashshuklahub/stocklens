import { auth, getSessionUserId } from '@/lib/auth'
import { formatLastSentIst } from '@/lib/whatsapp/ist-day'
import {
  indianMobileDisplay,
  normalizeIndianWhatsAppNumber,
  WhatsAppNumberError,
} from '@/lib/twilio/whatsapp'
import { createServerClient } from '@/lib/supabase'
import { NextRequest, NextResponse } from 'next/server'
import type { UserSettingsResponse } from '@/types'

function parsePreferences(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>
  }
  return {}
}

export async function GET() {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  const supabase = createServerClient()
  const { data: user, error } = await supabase
    .from('users')
    .select('whatsapp_number, preferences')
    .eq('id', userId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const prefs = parsePreferences(user.preferences)

  const { data: lastNotif } = await supabase
    .from('notifications_log')
    .select('sent_at')
    .eq('user_id', userId)
    .eq('type', 'daily_briefing')
    .eq('channel', 'whatsapp')
    .eq('delivered', true)
    .order('sent_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const lastSentAt = lastNotif?.sent_at ?? null

  const body: UserSettingsResponse = {
    whatsapp_number: indianMobileDisplay(user.whatsapp_number) || null,
    whatsapp_daily_briefing: prefs.whatsapp_daily_briefing === true,
    last_sent_at: lastSentAt,
    last_sent_label: lastSentAt ? formatLastSentIst(lastSentAt) : null,
  }

  return NextResponse.json(body)
}

type PatchBody = {
  whatsapp_number?: string | null
  whatsapp_daily_briefing?: boolean
}

export async function PATCH(req: NextRequest) {
  const session = await auth()
  const userId = getSessionUserId(session)
  if (!userId) {
    return NextResponse.json({ error: 'Session invalid — please sign in again' }, { status: 401 })
  }

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const supabase = createServerClient()
  const { data: existing, error: loadError } = await supabase
    .from('users')
    .select('whatsapp_number, preferences')
    .eq('id', userId)
    .single()

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 })

  const prefs = parsePreferences(existing.preferences)
  const updates: { whatsapp_number?: string | null; preferences?: Record<string, unknown> } = {}

  if ('whatsapp_number' in body) {
    const raw = body.whatsapp_number
    if (raw == null || raw === '') {
      updates.whatsapp_number = null
    } else {
      try {
        updates.whatsapp_number = normalizeIndianWhatsAppNumber(String(raw))
      } catch (err) {
        const message =
          err instanceof WhatsAppNumberError
            ? err.message
            : 'Enter a valid 10-digit Indian mobile number'
        return NextResponse.json({ error: message }, { status: 400 })
      }
    }
  }

  if (typeof body.whatsapp_daily_briefing === 'boolean') {
    prefs.whatsapp_daily_briefing = body.whatsapp_daily_briefing
  }

  const nextPhone =
    'whatsapp_number' in updates ? updates.whatsapp_number : existing.whatsapp_number
  const nextOptIn =
    typeof body.whatsapp_daily_briefing === 'boolean'
      ? body.whatsapp_daily_briefing
      : prefs.whatsapp_daily_briefing === true

  if (nextOptIn && !nextPhone) {
    return NextResponse.json(
      { error: 'Add a WhatsApp number before enabling daily briefing' },
      { status: 400 },
    )
  }

  updates.preferences = prefs

  const { error: updateError } = await supabase.from('users').update(updates).eq('id', userId)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return GET()
}
