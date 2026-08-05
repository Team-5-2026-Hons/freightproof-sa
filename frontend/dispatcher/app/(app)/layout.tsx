'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { DispatcherShell } from '@/components/layout/DispatcherShell'
import { RealtimeProvider } from '@/lib/realtime/RealtimeProvider'
import { ROUTES } from '@/lib/constants/routes'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
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
