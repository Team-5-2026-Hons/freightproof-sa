"use client"

import { createContext, useContext, useState, useCallback, useMemo } from 'react'
import { useAuth } from '@/lib/hooks/useAuth'

/** localStorage key for the persisted forensic-mode toggle. */
const FORENSIC_MODE_STORAGE_KEY = 'fp.forensicOn'

interface ForensicModeState {
  /** True if the current user has the admin_dispatcher role. */
  canViewForensics: boolean
  /** Persisted toggle (localStorage), defaults to OFF. */
  forensicOn: boolean
  /** No-op when !canViewForensics. */
  toggle: () => void
}

const ForensicModeContext = createContext<ForensicModeState | null>(null)

// Reads the persisted toggle on init. Guards against SSR (no `window`) and
// unavailable storage (privacy mode, disabled storage) by defaulting OFF and
// logging rather than throwing.
function readPersistedForensicOn(): boolean {
  if (typeof window === 'undefined') return false

  try {
    return window.localStorage.getItem(FORENSIC_MODE_STORAGE_KEY) === 'true'
  } catch (error) {
    console.warn('ForensicModeContext: localStorage unavailable, defaulting forensicOn to false', error)
    return false
  }
}

// Persists the toggle. Guards against SSR/no-storage the same way as the
// initial read — never throws on the caller.
function persistForensicOn(next: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(FORENSIC_MODE_STORAGE_KEY, String(next))
  } catch (error) {
    console.warn('ForensicModeContext: failed to persist forensicOn', error)
  }
}

export function ForensicModeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const [forensicOn, setForensicOn] = useState(readPersistedForensicOn)

  const canViewForensics = user?.role === 'admin_dispatcher'

  const toggle = useCallback(() => {
    if (!canViewForensics) return
    setForensicOn(prev => {
      const next = !prev
      persistForensicOn(next)
      return next
    })
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
