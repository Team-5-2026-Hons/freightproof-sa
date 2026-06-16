"use client"

import { createContext, useContext, useState, useCallback, useMemo } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'

interface ForensicModeState {
  /** True if the current user has the admin_dispatcher role. */
  canViewForensics: boolean
  /** Per-session toggle, defaults to OFF. Resets on page reload. */
  forensicOn: boolean
  /** No-op when !canViewForensics. */
  toggle: () => void
}

const ForensicModeContext = createContext<ForensicModeState | null>(null)

export function ForensicModeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [forensicOn, setForensicOn] = useState(false)

  const canViewForensics = user?.role === 'admin_dispatcher'

  const toggle = useCallback(() => {
    if (!canViewForensics) return
    setForensicOn(prev => !prev)
  }, [canViewForensics])

  const value = useMemo(
    () => ({ canViewForensics, forensicOn, toggle }),
    [canViewForensics, forensicOn, toggle],
  )

  return (
    <ForensicModeContext.Provider value={value}>
      {children}
    </ForensicModeContext.Provider>
  )
}

export function useForensicMode(): ForensicModeState {
  const ctx = useContext(ForensicModeContext)
  if (ctx === null) {
    throw new Error('useForensicMode must be used inside ForensicModeProvider')
  }
  return ctx
}
