'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { DispatcherShell } from '@/components/layout/DispatcherShell'
import { RealtimeProvider } from '@/lib/realtime/RealtimeProvider'
import { ROUTES } from '@/lib/constants/routes'
import { SUPPRESS_RETURN_SAVE_KEY } from '@/lib/context/AuthContext'
import { saveReturnPath } from '@shared/lib/session/return-path'

// Kept in step with AuthContext's own list.
const AUTH_ROUTE_PREFIXES = [ROUTES.login]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
      // Covers a session that disappears without the dispatcher choosing to leave — a
      // silently expired token, or landing on a guarded route with no session at all.
      // AuthContext's own signOut() already handled the deliberate case and marked it via
      // SUPPRESS_RETURN_SAVE_KEY, so this doesn't undo that clear.
      let suppressed = false
      try {
        suppressed = sessionStorage.getItem(SUPPRESS_RETURN_SAVE_KEY) === '1'
        sessionStorage.removeItem(SUPPRESS_RETURN_SAVE_KEY)
      } catch {
        // Can't tell either way — default to saving; a stray extra save is harmless.
      }
      if (!suppressed) {
        saveReturnPath(
          window.localStorage,
          window.location.pathname + window.location.search,
          AUTH_ROUTE_PREFIXES,
        )
      }
      router.replace(ROUTES.login)
    }
  }, [user, isLoading, router])

  if (isLoading || !user) return null

  // Mounted here (inside the auth gate) so the single SSE connection exists only for a
  // signed-in dispatcher, and tears down on sign-out when this layout unmounts.
  return (
    <RealtimeProvider>
      <DispatcherShell>{children}</DispatcherShell>
    </RealtimeProvider>
  )
}
