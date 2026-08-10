'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useContext, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { TripProvider } from '@/lib/context/TripContext'
import { LocationProvider } from '@/lib/context/LocationContext'
import { AppShell } from '@/components/layout/AppShell'
import { ROUTES } from '@/lib/constants/routes'
import { isFullBleedRoute } from '@/lib/navigation/full-bleed'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = useContext(AuthContext)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (!auth?.isLoading && !auth?.user) {
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
