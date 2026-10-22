'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useContext, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { AuthContext, SUPPRESS_RETURN_SAVE_KEY } from '@/lib/context/AuthContext'
import { TripProvider } from '@/lib/context/TripContext'
import { LocationProvider } from '@/lib/context/LocationContext'
import { DriverSubstitutionProvider } from '@/lib/context/DriverSubstitutionContext'
import { AppShell } from '@/components/layout/AppShell'
import { TripCompleteOverlay } from '@/components/trip/TripCompleteOverlay'
import { SimulatedGpsBanner } from '@/components/dev/SimulatedGpsBanner'
import { Button } from '@/components/ui/Button'
import { CapacitorBridge } from '@/components/layout/CapacitorBridge'
import { ROUTES } from '@/lib/constants/routes'
import { isFullBleedRoute } from '@/lib/navigation/full-bleed'
import { usePushNotifications } from '@/lib/hooks/usePushNotifications'
import { saveReturnPath } from '@shared/lib/session/return-path'

// Kept in step with AuthContext's own list — see that file for why '/otp' isn't in ROUTES.
const AUTH_ROUTE_PREFIXES = [ROUTES.login, '/otp']

// Rendered only once a driver is signed in, so the token POST carries their bearer, and
// once per app (not per page) so each push event has exactly one listener behind it.
function PushNotificationsListener(): null {
  usePushNotifications()
  return null
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = useContext(AuthContext)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!auth?.isLoading && !auth?.user && !auth?.connectionFault) {
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
    // connectionFault included deliberately: a retry that fails to restore a user must
    // re-evaluate this guard, so a session that really did expire still reaches /login
    // once the fault clears.
  }, [auth?.user, auth?.isLoading, auth?.connectionFault, router])

  // Checked before the loading/!user branch: a driver whose profile load got no answer
  // is neither loading nor signed out, and must not be told either of those things.
  if (auth?.connectionFault && !auth.isLoading) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
        <h1 className="text-title-3 text-surface-on">Can&apos;t reach FreightProof</h1>
        <p className="text-subhead text-surface-on-variant">
          You are still signed in. The app could not reach the server to load your trips —
          check your signal and try again.
        </p>
        <Button variant="primary" size="md" className="mt-2" onClick={() => void auth.retryProfile()}>
          Try again
        </Button>
      </main>
    )
  }

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
    // the real work happens) as well as the shell routes. DriverSubstitutionProvider also
    // sits inside TripProvider, so a completed handover can drop the working trip at once;
    // it is mounted here, once, so every screen shares a single notice refresh timer.
    <TripProvider>
      <PushNotificationsListener />
      <CapacitorBridge />
      <DriverSubstitutionProvider>
        <LocationProvider>
          <SimulatedGpsBanner />
          {isFullBleedRoute(pathname) ? children : <AppShell>{children}</AppShell>}
          {/* Inside TripProvider (it reads the completed-trip snapshot) and last, so it
              paints over whatever screen the final hand-off navigated to. */}
          <TripCompleteOverlay />
        </LocationProvider>
      </DriverSubstitutionProvider>
    </TripProvider>
  )
}
