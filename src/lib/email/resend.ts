import { env } from '@/lib/env'

export type SendEmailResult =
  | { sent: true; id: string }
  | { sent: false; reason: string }

export async function sendReportEmail(options: {
  subject: string
  text: string
}): Promise<SendEmailResult> {
  const apiKey = env.RESEND_API_KEY
  const to = env.PICKS_REPORT_EMAIL
  const from = env.EMAIL_FROM

  if (!apiKey) {
    return { sent: false, reason: 'RESEND_API_KEY not set' }
  }
  if (!to) {
    return { sent: false, reason: 'PICKS_REPORT_EMAIL not set' }
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: options.subject,
      text: options.text,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { sent: false, reason: `Resend HTTP ${res.status}: ${body.slice(0, 200)}` }
  }

  const data = (await res.json()) as { id?: string }
  return { sent: true, id: data.id ?? 'unknown' }
}

export function isEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY && env.PICKS_REPORT_EMAIL)
}
