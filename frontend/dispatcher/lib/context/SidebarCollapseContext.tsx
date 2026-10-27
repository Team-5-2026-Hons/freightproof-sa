"use client"

import { createContext, useContext, useState, useCallback, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { ROUTES } from '@/lib/constants/routes'

const SIDEBAR_COLLAPSE_STORAGE_KEY = 'fp.sidebarCollapsed'

interface SidebarCollapseState {
  collapsed: boolean
  toggle: () => void
}

const SidebarCollapseContext = createContext<SidebarCollapseState | null>(null)

function readPersistedCollapsed(): boolean {
  if (typeof window === 'undefined') return false

  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === 'true'
  } catch (error) {
    console.warn('SidebarCollapseContext: localStorage unavailable, defaulting collapsed to false', error)
    return false
  }
}

function persistCollapsed(next: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, String(next))
  } catch (error) {
    console.warn('SidebarCollapseContext: failed to persist collapsed', error)
  }
}

function isTripDetailRoute(pathname: string): boolean {
  return /^\/trips\/[^/]+$/.test(pathname) && pathname !== ROUTES.tripNew
}

export function SidebarCollapseProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [preferredCollapsed, setPreferredCollapsed] = useState(readPersistedCollapsed)

  const [sessionOverride, setSessionOverride] = useState<boolean | null>(null)
  const [trackedPathname, setTrackedPathname] = useState(pathname)
  if (pathname !== trackedPathname) {
    setTrackedPathname(pathname)
    setSessionOverride(null)
  }

  const routeForcedCollapse = isTripDetailRoute(pathname)
  const collapsed = sessionOverride ?? (routeForcedCollapse || preferredCollapsed)

  const toggle = useCallback(() => {
    if (routeForcedCollapse) {
      setSessionOverride(!collapsed)
      return
    }
    setPreferredCollapsed(prev => {
      const next = !prev
      persistCollapsed(next)
      return next
    })
  }, [routeForcedCollapse, collapsed])

  const value = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle])

  return (
    <SidebarCollapseContext.Provider value={value}>
      {children}
    </SidebarCollapseContext.Provider>
  )
}

export function useSidebarCollapse(): SidebarCollapseState {
  const ctx = useContext(SidebarCollapseContext)
  if (ctx === null) {
    throw new Error('useSidebarCollapse must be used inside SidebarCollapseProvider')
  }
  return ctx
}
