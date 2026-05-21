import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import type { Session } from 'next-auth'
import { createServerClient } from '@/lib/supabase'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isValidUuid(value: string): boolean {
  return UUID_RE.test(value)
}

/** Supabase users.id — never the OAuth provider subject. */
export function getSessionUserId(session: Session | null): string | null {
  const id = session?.user?.id
  if (!id || !isValidUuid(id)) return null
  return id
}

async function resolveDbUserId(email: string): Promise<string | null> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (error) {
    console.error('[auth] users lookup failed:', error.message)
    return null
  }
  return data?.id ?? null
}

async function ensureDbUser(email: string): Promise<string | null> {
  const existing = await resolveDbUserId(email)
  if (existing) return existing

  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('users')
    .upsert({ email }, { onConflict: 'email' })
    .select('id')
    .single()

  if (error) {
    console.error('[auth] users upsert failed:', error.message)
    return null
  }
  return data?.id ?? null
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ user }) {
      if (!user.email) return false
      const supabase = createServerClient()

      const { data: allowed } = await supabase
        .from('allowed_emails')
        .select('email')
        .eq('email', user.email)
        .single()

      if (!allowed) return '/login?error=AccessDenied'

      const userId = await ensureDbUser(user.email)
      if (!userId) return '/login?error=AccessDenied'

      return true
    },

    async jwt({ token, user }) {
      const email = user?.email ?? (typeof token.email === 'string' ? token.email : null)
      if (email) {
        token.email = email
        const userId = await ensureDbUser(email)
        if (userId) token.userId = userId
      }
      return token
    },

    async session({ session, token }) {
      const userId = typeof token.userId === 'string' ? token.userId : ''
      // Only expose our Supabase UUID — never OAuth `sub` (invalid for Postgres uuid columns).
      if (isValidUuid(userId)) {
        session.user.id = userId
      } else {
        session.user.id = ''
      }
      return session
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
})

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      image?: string | null
    }
  }
}
