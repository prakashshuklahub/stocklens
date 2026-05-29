'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import { MessageCircle } from 'lucide-react'
import AppNav from '@/components/AppNav'
import SettingsAccountHeader from '@/components/settings/SettingsAccountHeader'
import SettingsAlert from '@/components/settings/SettingsAlert'
import SettingsLoadingSkeleton from '@/components/settings/SettingsLoadingSkeleton'
import SettingsPhoneInput from '@/components/settings/SettingsPhoneInput'
import SettingsRow from '@/components/settings/SettingsRow'
import SettingsSaveBar from '@/components/settings/SettingsSaveBar'
import SettingsSection from '@/components/settings/SettingsSection'
import SettingsToggle from '@/components/settings/SettingsToggle'
import type { UserSettingsResponse } from '@/types'

const fetcher = async (url: string): Promise<UserSettingsResponse> => {
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(data.error ?? 'Failed to load settings')
  }
  return res.json()
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

      <main id="main" className="page-shell !pt-2 pb-28">
        <header className="mb-6">
          <h1 className="page-title text-[1.75rem]">Settings</h1>
          <p className="page-subtitle">Notifications and preferences</p>
        </header>

        {isLoading && !data ? (
          <SettingsLoadingSkeleton />
        ) : error ? (
          <SettingsAlert message={error.message} />
        ) : (
          <div className="space-y-7">
            <SettingsAccountHeader />

            <SettingsSection
              title="WhatsApp"
              footer="Messages include your holding tickers and daily briefing text. You can turn this off anytime."
            >
              <div className="px-4 py-3.5 space-y-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/15 flex items-center justify-center shrink-0">
                    <MessageCircle className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-[15px] font-medium text-white">Mobile number</p>
                    <p className="text-xs text-zinc-500">10-digit Indian mobile</p>
                  </div>
                </div>
                <SettingsPhoneInput
                  id="whatsapp-phone"
                  value={phone}
                  onChange={setPhone}
                  disabled={saving}
                />
              </div>

              <SettingsRow
                htmlFor="whatsapp-opt-in"
                label="Daily portfolio briefing"
                description="Sent at 10:30 AM ET on US market days (Mon–Fri), one hour after open."
                meta={data?.last_sent_label ? `Last sent · ${data.last_sent_label}` : undefined}
              >
                <SettingsToggle
                  id="whatsapp-opt-in"
                  checked={optIn}
                  onChange={setOptIn}
                  disabled={saving}
                  aria-label="Enable WhatsApp daily briefing"
                />
              </SettingsRow>
            </SettingsSection>

            <SettingsSection title="About">
              <SettingsRow label="App" trailing="Stocklens" />
              <SettingsRow label="Version" trailing="0.1.0" />
            </SettingsSection>

            {saveError && <SettingsAlert message={saveError} />}
          </div>
        )}

        <SettingsSaveBar
          visible={Boolean(dirty && !isLoading && !error)}
          saving={saving}
          saved={saved}
          disabled={!dirty}
          onSave={handleSave}
        />
      </main>
    </div>
  )
}
