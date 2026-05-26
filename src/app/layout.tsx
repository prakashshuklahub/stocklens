import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SessionProvider } from 'next-auth/react'
import { auth } from '@/lib/auth'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Stocklens',
  description: 'Track the stocks you truly believe in.',
  applicationName: 'Stocklens',
  appleWebApp: {
    capable: true,
    title: 'Stocklens',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()

  return (
    <html
      lang="en"
      className="dark h-full"
      style={{ colorScheme: 'dark' }}
      suppressHydrationWarning
    >
      <body
        className={`${inter.variable} font-sans h-full bg-zinc-950 text-zinc-100 antialiased selection:bg-blue-500/30`}
        suppressHydrationWarning
      >
        <SessionProvider session={session} refetchOnWindowFocus={false}>{children}</SessionProvider>
      </body>
    </html>
  )
}
