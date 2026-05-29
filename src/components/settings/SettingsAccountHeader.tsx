'use client'

import { useSession } from 'next-auth/react'

export default function SettingsAccountHeader() {
  const { data: session } = useSession()
  const user = session?.user
  const initials = user?.name
    ? user.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <div className="flex items-center gap-4 px-1 py-1">
      {user?.image ? (
        <img
          src={user.image}
          alt=""
          width={56}
          height={56}
          className="w-14 h-14 rounded-2xl ring-2 ring-zinc-800 object-cover"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div
          aria-hidden="true"
          className="w-14 h-14 rounded-2xl bg-zinc-800 flex items-center justify-center text-lg font-bold text-zinc-300"
        >
          {initials}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-lg font-bold text-white truncate">{user?.name ?? 'Account'}</p>
        <p className="text-sm text-zinc-500 truncate">{user?.email ?? ''}</p>
      </div>
    </div>
  )
}
