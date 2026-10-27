'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { useToast } from '@/lib/hooks/useToast'
import { AssistantBubble } from '@/components/assistant/AssistantBubble'
import { DispatcherShell } from '@/components/layout/DispatcherShell'
import { RealtimeProvider } from '@/lib/realtime/RealtimeProvider'
import { ROUTES } from '@/lib/constants/routes'
import { SUPPRESS_RETURN_SAVE_KEY } from '@/lib/context/AuthContext'
import { saveReturnPath } from '@shared/lib/session/return-path'

const AUTH_ROUTE_PREFIXES = [ROUTES.login]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth()
  const { clear: clearToasts } = useToast()
  const router = useRouter()

  useEffect(() => {
    if (!isLoading && !user) {
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
      clearToasts()
      router.replace(ROUTES.login)
    }
  }, [user, isLoading, router, clearToasts])

  if (isLoading || !user) return null

  return (
    <RealtimeProvider>
      <DispatcherShell>{children}</DispatcherShell>
      <AssistantBubble />
    </RealtimeProvider>
  )
}
