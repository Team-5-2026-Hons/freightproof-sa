'use client'

// Required: output: 'export' (Capacitor APK) is incompatible with Server Components.

import { useContext, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AuthContext } from '@/lib/context/AuthContext'
import { TripProvider } from '@/lib/context/TripContext'
import { ROUTES } from '@/lib/constants/routes'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const auth = useContext(AuthContext)
  const router = useRouter()

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

  return <TripProvider>{children}</TripProvider>
}
