'use client'

import type { ReactNode } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'

interface AdminOnlyProps {
  children: ReactNode
}

/**
 * Renders children only when the current user has the admin_dispatcher role.
 * Single gate for admin-only affordances — call sites stay dumb.
 */
export function AdminOnly({ children }: AdminOnlyProps) {
  const { user } = useAuth()
  if (user?.role !== 'admin_dispatcher') return null
  return <>{children}</>
}
