'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/hooks/useAuth'
import { DispatcherShell } from '@/components/layout/DispatcherShell'
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

  return <DispatcherShell>{children}</DispatcherShell>
}
