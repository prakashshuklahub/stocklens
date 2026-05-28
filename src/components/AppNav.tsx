'use client'

import { signOut, useSession } from 'next-auth/react'
import { TrendingUp, LogOut, BarChart2, Sparkles, PieChart, Settings } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

const BOTTOM_TABS = [
  { href: '/watchlist', label: 'Watchlist', Icon: BarChart2 },
  { href: '/picks',     label: 'Picks',     Icon: Sparkles },
  { href: '/portfolio', label: 'Portfolio', Icon: PieChart },
]

export default function AppNav() {
  const { data: session } = useSession()
  const pathname = usePathname()
  const user = session?.user
  const initials = user?.name
    ? user.name.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <>
      <header
        className="sticky top-0 z-40 bg-zinc-950/92 backdrop-blur-xl border-b border-white/[0.06] shadow-sm shadow-black/20"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <div className="max-w-xl mx-auto px-5 h-[var(--header-height)] flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-500/12 border border-blue-500/20 flex items-center justify-center">
              <TrendingUp className="w-[18px] h-[18px] text-blue-400" aria-hidden="true" />
            </div>
            <span className="font-bold text-white text-base tracking-tight">Stocklens</span>
          </div>

          <div className="flex items-center gap-0.5">
            <Link
              href="/settings"
              aria-label="Settings"
              aria-current={pathname.startsWith('/settings') ? 'page' : undefined}
              className={cn(
                'w-11 h-11 flex items-center justify-center rounded-xl transition-colors',
                '[touch-action:manipulation] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500',
                pathname.startsWith('/settings')
                  ? 'text-white bg-zinc-800/80'
                  : 'text-zinc-500 hover:text-zinc-300 active:bg-zinc-800/80',
              )}
            >
              <Settings className="w-5 h-5" aria-hidden="true" />
            </Link>

            {user?.image ? (
              <img
                src={user.image}
                alt={user.name ?? 'User avatar'}
                width={36}
                height={36}
                className="w-9 h-9 rounded-full ring-2 ring-zinc-800 mx-0.5"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div
                aria-label={`Signed in as ${user?.email ?? 'unknown'}`}
                className="w-9 h-9 rounded-full bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-300 mx-0.5"
              >
                {initials}
              </div>
            )}

            <button
              onClick={() => signOut({ callbackUrl: '/' })}
              aria-label="Sign out"
              className="w-11 h-11 flex items-center justify-center rounded-xl text-zinc-500 hover:text-zinc-300 active:bg-zinc-800/80 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-500 [touch-action:manipulation]"
            >
              <LogOut className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <nav
        aria-label="App navigation"
        className="fixed bottom-0 inset-x-0 z-40 bg-zinc-950/95 backdrop-blur-md border-t border-white/[0.08] shadow-[0_-8px_24px_rgba(0,0,0,0.35)]"
      >
        <div
          className="max-w-xl mx-auto flex items-stretch"
          style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {BOTTOM_TABS.map(({ href, label, Icon }) => {
            const active = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[var(--nav-height)] relative',
                  '[touch-action:manipulation] active:opacity-70 transition-opacity focus-visible:outline-none',
                  active && 'bg-white/[0.03]',
                )}
              >
                {active && (
                  <span
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-10 h-[3px] bg-blue-400 rounded-full"
                    aria-hidden="true"
                  />
                )}
                <Icon
                  className={cn(
                    'w-6 h-6 transition-all duration-150',
                    active ? 'text-blue-400' : 'text-zinc-500',
                  )}
                  aria-hidden="true"
                  strokeWidth={active ? 2.5 : 2}
                />
                <span
                  className={cn(
                    'text-sm sm:text-xs font-semibold leading-none',
                    active ? 'text-white' : 'text-zinc-500',
                  )}
                >
                  {label}
                </span>
              </Link>
            )
          })}
        </div>
      </nav>
    </>
  )
}
