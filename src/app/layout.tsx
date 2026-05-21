import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { SessionProvider } from 'next-auth/react'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

export const metadata: Metadata = {
  title: 'Stocklens',
  description: 'Track the stocks you truly believe in.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#09090b',
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark h-full" style={{ colorScheme: 'dark' }}>
      <body className={`${inter.variable} font-sans h-full bg-zinc-950 text-zinc-100 antialiased selection:bg-blue-500/30`}>
        <SessionProvider refetchOnWindowFocus={false}>{children}</SessionProvider>
      </body>
    </html>
  )
}
