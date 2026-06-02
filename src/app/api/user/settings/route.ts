import { auth, getSessionUserId } from '@/lib/auth'
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
    .select('whatsapp_number')
    .eq('id', userId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const body: UserSettingsResponse = {
    whatsapp_number: indianMobileDisplay(user.whatsapp_number) || null,
  }

  return NextResponse.json(body)
}

type PatchBody = {
  whatsapp_number?: string | null
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
    .select('preferences')
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

  // WhatsApp briefings disabled — keep opt-in off when saving contact info.
  prefs.whatsapp_daily_briefing = false
  updates.preferences = prefs

  const { error: updateError } = await supabase.from('users').update(updates).eq('id', userId)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return GET()
}
