import { env } from '@/lib/env'
import {
  WHATSAPP_BRIEFING_FOOTER,
  WHATSAPP_HOLDING_DIVIDER,
} from '@/lib/whatsapp/format-briefing'

const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/

export class WhatsAppNumberError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WhatsAppNumberError'
  }
}

export function isValidIndianMobile(digits: string): boolean {
  return INDIAN_MOBILE_RE.test(digits)
}

/** Strip to 10 Indian mobile digits or throw. Accepts +91 prefix or raw 10 digits. */
export function normalizeIndianWhatsAppNumber(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new WhatsAppNumberError('Enter a valid 10-digit Indian mobile number')

  const digitsOnly = trimmed.replace(/\D/g, '')
  let mobile: string

  if (digitsOnly.length === 10) {
    mobile = digitsOnly
  } else if (digitsOnly.length === 12 && digitsOnly.startsWith('91')) {
    mobile = digitsOnly.slice(2)
  } else if (trimmed.startsWith('+91') && digitsOnly.length === 12) {
    mobile = digitsOnly.slice(2)
  } else {
    throw new WhatsAppNumberError('Enter a valid 10-digit Indian mobile number')
  }

  if (!isValidIndianMobile(mobile)) {
    throw new WhatsAppNumberError('Enter a valid 10-digit Indian mobile number')
  }

  return `+91${mobile}`
}

/** Display 10 digits from stored E.164 (+91…). */
export function indianMobileDisplay(stored: string | null | undefined): string {
  if (!stored) return ''
  const digits = stored.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2)
  if (digits.length === 10) return digits
  return ''
}

export type SendWhatsAppResult =
  | { ok: true; sid: string }
  | { ok: false; code: number | null; message: string; permanent: boolean }

export function isTwilioConfigured(): boolean {
  return Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_WHATSAPP_FROM)
}

function twilioFromAddress(): string {
  const from = env.TWILIO_WHATSAPP_FROM.trim()
  return from.startsWith('whatsapp:') ? from : `whatsapp:${from}`
}

function twilioToAddress(e164: string): string {
  const normalized = e164.startsWith('+') ? e164 : `+${e164}`
  return normalized.startsWith('whatsapp:') ? normalized : `whatsapp:${normalized}`
}

/** Permanent Twilio errors — invalid destination, opt user out. */
function isPermanentTwilioError(code: number | null): boolean {
  if (code == null) return false
  return [21211, 21614, 21608, 63003, 63024].includes(code)
}

/** Twilio WhatsApp sandbox body limit; production allows ~4096. */
export const WHATSAPP_SANDBOX_BODY_MAX = 1600

const FOOTER_RE = /\n\n(?:—\n_)?Reply STOP to opt out_?\s*$/

function stripBriefingFooter(body: string): string {
  const idx = body.lastIndexOf(WHATSAPP_BRIEFING_FOOTER)
  if (idx >= 0) return body.slice(0, idx).trimEnd()
  const legacy = body.match(FOOTER_RE)
  if (legacy?.index != null) return body.slice(0, legacy.index).trimEnd()
  return body.trimEnd()
}

/** Split long briefings for sandbox (1600 char) at holding boundaries. */
export function splitWhatsAppBody(body: string, maxLen = WHATSAPP_SANDBOX_BODY_MAX): string[] {
  if (body.length <= maxLen) return [body]

  const footer = WHATSAPP_BRIEFING_FOOTER
  const main = stripBriefingFooter(body)

  const parts: string[] = []
  let rest = main
  let partIndex = 0

  while (rest.length > 0) {
    partIndex++
    const isLast = rest.length + footer.length <= maxLen
    if (isLast) {
      parts.push(`${rest}${footer}`.trim())
      break
    }

    const budget = maxLen - `\n\n(continued ${partIndex + 1}/…)`.length
    let splitAt = rest.lastIndexOf(WHATSAPP_HOLDING_DIVIDER, budget)
    if (splitAt <= 0) splitAt = rest.lastIndexOf('\n*', budget)
    if (splitAt <= 0) splitAt = budget

    parts.push(`${rest.slice(0, splitAt).trim()}\n\n(continued ${partIndex + 1}/…)`)
    rest = rest.slice(splitAt).trimStart()
  }

  return parts
}

export async function sendWhatsAppMessageParts(
  toE164: string,
  body: string,
  delayMs = 1000,
): Promise<SendWhatsAppResult[]> {
  const parts = splitWhatsAppBody(body)
  const results: SendWhatsAppResult[] = []

  for (let i = 0; i < parts.length; i++) {
    const result = await sendWhatsAppMessage(toE164, parts[i]!)
    results.push(result)
    if (!result.ok) return results
    if (i < parts.length - 1) {
      await new Promise((r) => setTimeout(r, delayMs))
    }
  }

  return results
}

export async function sendWhatsAppMessage(toE164: string, body: string): Promise<SendWhatsAppResult> {
  if (!isTwilioConfigured()) {
    return { ok: false, code: null, message: 'Twilio not configured', permanent: false }
  }

  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')
  const params = new URLSearchParams({
    From: twilioFromAddress(),
    To: twilioToAddress(toE164),
    Body: body,
  })

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    },
  )

  const data = (await res.json()) as { sid?: string; code?: number; message?: string }

  if (res.ok && data.sid) {
    return { ok: true, sid: data.sid }
  }

  const code = typeof data.code === 'number' ? data.code : null
  const message = data.message ?? `Twilio HTTP ${res.status}`
  return { ok: false, code, message, permanent: isPermanentTwilioError(code) }
}
