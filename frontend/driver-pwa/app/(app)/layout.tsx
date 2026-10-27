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
import { LeaveEndedTripScreen } from '@/components/trip/LeaveEndedTripScreen'
import { Button } from '@/components/ui/Button'
import { CapacitorBridge } from '@/components/layout/CapacitorBridge'
import { ROUTES } from '@/lib/constants/routes'
import { isFullBleedRoute } from '@/lib/navigation/full-bleed'
import { usePushNotifications } from '@/lib/hooks/usePushNotifications'
import { saveReturnPath } from '@shared/lib/session/return-path'

const AUTH_ROUTE_PREFIXES = [ROUTES.login, '/otp']

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
      let suppressed = false
      try {
        suppressed = sessionStorage.getItem(SUPPRESS_RETURN_SAVE_KEY) === '1'
        sessionStorage.removeItem(SUPPRESS_RETURN_SAVE_KEY)
      } catch {
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
  }, [auth?.user, auth?.isLoading, auth?.connectionFault, router])

  if (auth?.connectionFault && !auth.isLoading) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-8 text-center">
        <h1 className="text-title-3 text-surface-on">Can&apos;t reach FreightProof</h1>
        <p className="text-subhead text-surface-on-variant">
          You are still signed in. The app could not reach the server to load your trips.
          Check your signal and try again.
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
    <TripProvider>
      <PushNotificationsListener />
      <CapacitorBridge />
      <LeaveEndedTripScreen />
      <DriverSubstitutionProvider>
        <LocationProvider>
          {isFullBleedRoute(pathname) ? children : <AppShell>{children}</AppShell>}
          <TripCompleteOverlay />
        </LocationProvider>
      </DriverSubstitutionProvider>
    </TripProvider>
  )
}
