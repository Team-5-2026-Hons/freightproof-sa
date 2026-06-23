'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useContext, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { TripProvider } from '@/lib/context/TripContext'
import { AppShell } from '@/components/layout/AppShell'
import { ROUTES } from '@/lib/constants/routes'

// AppShell's header is in normal layout flow (not overlaid), so it always adds
// its own height on top of whatever the page renders. Panic and handshake-step
// pages already own their full layout (panic is a bare full-bleed emergency
// surface; handshake steps render their own sticky StepHeader with real
// back-navigation) — stacking AppShell's chrome on top causes viewport
// overflow on panic (pushing the cancel link below the fold) and a redundant
// double sticky header on handshake steps. Exempt both from AppShell entirely.
function isFullBleedRoute(pathname: string): boolean {
  return pathname.includes('/panic') || pathname.includes('/handshake/')
}

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
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-surface-on-variant">Loading…</p>
      </main>
    )
  }

  return (
    <TripProvider>
      {isFullBleedRoute(pathname) ? children : <AppShell>{children}</AppShell>}
    </TripProvider>
  )
}
