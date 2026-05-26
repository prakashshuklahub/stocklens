import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import LoginContent from './LoginContent'

export default async function LoginPage() {
  const session = await auth()
  if (session?.user) redirect('/watchlist')

  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  )
}
