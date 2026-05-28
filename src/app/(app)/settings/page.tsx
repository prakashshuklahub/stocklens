'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import AppNav from '@/components/AppNav'
import { cn } from '@/lib/utils'
import type { UserSettingsResponse } from '@/types'

const fetcher = async (url: string): Promise<UserSettingsResponse> => {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? 'Failed to load settings')
  }
  return res.json()
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, 10)
}

export default function SettingsPage() {
  const { data, error, isLoading, mutate } = useSWR<UserSettingsResponse>(
    '/api/user/settings',
    fetcher,
    { revalidateOnFocus: false },
  )

  const [phone, setPhone] = useState('')
  const [optIn, setOptIn] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    if (!data) return
    setPhone(data.whatsapp_number ?? '')
    setOptIn(data.whatsapp_daily_briefing)
    setHydrated(true)
  }, [data])

  const dirty =
    hydrated &&
    data &&
    (phone !== (data.whatsapp_number ?? '') || optIn !== data.whatsapp_daily_briefing)

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    setSaved(false)

    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          whatsapp_number: phone.trim() || null,
          whatsapp_daily_briefing: optIn,
        }),
      })

      const payload = (await res.json()) as UserSettingsResponse & { error?: string }
      if (!res.ok) throw new Error(payload.error ?? 'Save failed')

      await mutate(payload, { revalidate: false })
      setPhone(payload.whatsapp_number ?? '')
      setOptIn(payload.whatsapp_daily_briefing)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-zinc-950">
      <AppNav />

      <main id="main" className="page-shell !pt-1">
        <h1 className="text-lg font-bold text-white mb-1">Settings</h1>
        <p className="text-sm text-zinc-500 mb-6">WhatsApp daily portfolio briefing</p>

        {isLoading && !data ? (
          <div className="flex items-center gap-2 text-zinc-500 text-sm py-8">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        ) : error ? (
          <div className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-400">{error.message}</p>
          </div>
        ) : (
          <div className="space-y-5">
            <section className="rounded-xl border border-white/[0.06] bg-zinc-900/50 p-4 space-y-4">
              <div>
                <label htmlFor="whatsapp-phone" className="block text-sm font-semibold text-white mb-2">
                  WhatsApp number
                </label>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 px-3 h-11 flex items-center rounded-xl bg-zinc-800 text-zinc-300 text-sm font-semibold border border-white/[0.06]">
                    +91
                  </span>
                  <input
                    id="whatsapp-phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    placeholder="9876543210"
                    value={phone}
                    onChange={(e) => setPhone(digitsOnly(e.target.value))}
                    className="flex-1 min-w-0 h-11 px-3 rounded-xl bg-zinc-950 border border-white/[0.08] text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <p className="mt-2 text-xs text-zinc-500">10-digit Indian mobile number</p>
              </div>

              <label className="flex items-start gap-3 cursor-pointer [touch-action:manipulation]">
                <input
                  type="checkbox"
                  checked={optIn}
                  onChange={(e) => setOptIn(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-blue-500 focus:ring-blue-500/40"
                />
                <span className="text-sm text-zinc-300 leading-snug">
                  Send my portfolio daily briefing to WhatsApp at 10:30 AM ET (1 hour after US market open, Mon–Fri)
                </span>
              </label>

              {data?.last_sent_label && (
                <p className="text-xs text-zinc-500 tabular-nums">
                  Last sent · {data.last_sent_label}
                </p>
              )}

              <p className="text-xs text-zinc-600 leading-relaxed">
                Messages include your holding tickers and summary text. You can turn this off
                anytime.
              </p>
            </section>

            {saveError && (
              <div className="flex items-start gap-2 rounded-xl bg-red-500/10 px-3 py-2.5">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-400">{saveError}</p>
              </div>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={!dirty || saving}
              className={cn(
                'w-full h-11 rounded-xl text-sm font-semibold transition-all [touch-action:manipulation]',
                'disabled:opacity-40 disabled:cursor-not-allowed',
                saved
                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20'
                  : 'bg-blue-500 text-white active:scale-[0.98]',
              )}
            >
              {saving ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  Saving…
                </span>
              ) : saved ? (
                <span className="inline-flex items-center gap-2">
                  <Check className="w-4 h-4" aria-hidden="true" />
                  Saved
                </span>
              ) : (
                'Save settings'
              )}
            </button>
          </div>
        )}
      </main>
    </div>
  )
}
