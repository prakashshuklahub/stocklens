import NextAuth from 'next-auth'
import Google from 'next-auth/providers/google'
import { createServerClient } from '@/lib/supabase'

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

      // Check whitelist
      const { data: allowed } = await supabase
        .from('allowed_emails')
        .select('email')
        .eq('email', user.email)
        .single()

      if (!allowed) return '/login?error=AccessDenied'

      // Upsert user
      await supabase.from('users').upsert(
        { email: user.email, name: user.name, avatar_url: user.image },
        { onConflict: 'email' }
      )

      return true
    },

    async jwt({ token, user }) {
      if (user?.email) {
        const supabase = createServerClient()
        const { data: dbUser } = await supabase
          .from('users')
          .select('id')
          .eq('email', user.email)
          .single()
        if (dbUser) token.userId = dbUser.id
      }
      return token
    },

    async session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string
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
