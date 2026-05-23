import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth((req) => {
  const { pathname } = req.nextUrl

  const isDevMigrate =
    process.env.NODE_ENV !== 'production' && pathname.startsWith('/api/setup/migrate')

  const isPublicPath =
    pathname === '/' ||
    pathname.startsWith('/login') ||
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/api/cron') ||
    isDevMigrate

  if (!req.auth && !isPublicPath) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon-|manifest|apple-icon|firebase-messaging-sw.js).*)'],
}
