'use client'

import type { ReactNode } from 'react'
import { useForensicMode } from '@/lib/context/ForensicModeContext'

interface ForensicOnlyProps {
  children: ReactNode
}

/**
 * Renders children only when the current user has the admin_dispatcher role
 * AND has switched forensic mode ON. Call sites stay dumb — this is the single gate.
 */
export function ForensicOnly({ children }: ForensicOnlyProps) {
  const { canViewForensics, forensicOn } = useForensicMode()
  if (!canViewForensics || !forensicOn) return null
  return <>{children}</>
}
