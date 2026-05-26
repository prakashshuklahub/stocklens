'use client'

import { signIn, useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'
import { TrendingUp } from 'lucide-react'

export default function LoginContent() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useSearchParams()
  const denied = params.get('error') === 'AccessDenied'

  useEffect(() => {
    if (session?.user) router.replace('/watchlist')
  }, [session, router])

  if (status === 'loading' || session?.user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-5 h-5 rounded-full border-2 border-zinc-700 border-t-zinc-400 animate-spin" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center" aria-hidden="true">
            <TrendingUp className="w-5 h-5 text-blue-400" aria-hidden="true" />
          </div>
          <div>
            <p className="text-lg font-bold text-white tracking-tight">Stocklens</p>
            <p className="text-xs text-zinc-500">Your intelligent stock watchlist</p>
          </div>
        </div>

        <h1 className="text-3xl font-bold text-white mb-1 tracking-tight">Sign in</h1>
        <p className="text-zinc-500 text-base mb-8 leading-relaxed">
          Access is invite-only. Sign in with your approved Google account.
        </p>

        {denied && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3 mb-5">
            <p className="text-red-400 text-sm font-medium">Access denied</p>
            <p className="text-red-400/70 text-xs mt-0.5">
              Your email is not on the approved list. Contact the admin to request access.
            </p>
          </div>
        )}

        <button
          onClick={() => signIn('google', { callbackUrl: '/watchlist' })}
          className="w-full min-h-[48px] flex items-center justify-center gap-3 bg-white hover:bg-zinc-100 active:bg-zinc-200 text-zinc-900 font-semibold text-base py-3.5 px-4 rounded-xl transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 [touch-action:manipulation]"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Continue with Google
        </button>

        <p className="text-center text-xs text-muted mt-8">
          By signing in you agree to use this tool responsibly.
        </p>
      </div>
    </div>
  )
}
