import { redirect } from 'next/navigation'

/** Signals tab removed — watchlist cards now show signal chips + headlines. */
export default function NewsPage() {
  redirect('/watchlist')
}
