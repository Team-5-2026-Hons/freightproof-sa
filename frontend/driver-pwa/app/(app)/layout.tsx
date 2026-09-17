'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useContext, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { AuthContext, SUPPRESS_RETURN_SAVE_KEY } from '@/lib/context/AuthContext'
import { TripProvider } from '@/lib/context/TripContext'
import { LocationProvider } from '@/lib/context/LocationContext'
import { AppShell } from '@/components/layout/AppShell'
import { ROUTES } from '@/lib/constants/routes'
import { isFullBleedRoute } from '@/lib/navigation/full-bleed'
import { saveReturnPath } from '@shared/lib/session/return-path'

// Kept in step with AuthContext's own list — see that file for why '/otp' isn't in ROUTES.
const AUTH_ROUTE_PREFIXES = [ROUTES.login, '/otp']

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = useContext(AuthContext)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!auth?.isLoading && !auth?.user) {
      // Covers a session that disappears without the driver choosing to leave — a
      // silently expired token, or landing on a guarded route (e.g. a deep link) with no
      // session at all. AuthContext's own signOut() already handled the deliberate case
      // and marked it via SUPPRESS_RETURN_SAVE_KEY, so this doesn't undo that clear.
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
  }, [auth?.user, auth?.isLoading, router])

  if (auth?.isLoading || !auth?.user) {
    return (
      <main className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-surface-on-variant">Loading…</p>
      </main>
    )
  }

  return (
    // LocationProvider sits INSIDE TripProvider, not beside it: it only records a
    // position while a trip is open, which means it has to be able to read the current
    // trip. It wraps both branches so the trail covers full-bleed phase screens (where
    // the real work happens) as well as the shell routes.
    <TripProvider>
      <LocationProvider>
        {isFullBleedRoute(pathname) ? children : <AppShell>{children}</AppShell>}
      </LocationProvider>
    </TripProvider>
  )
}
