"use client"

import { createContext, useContext, useState, useCallback, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import { ROUTES } from '@/lib/constants/routes'

/** localStorage key for the persisted sidebar collapse preference. */
const SIDEBAR_COLLAPSE_STORAGE_KEY = 'fp.sidebarCollapsed'

interface SidebarCollapseState {
  /** Effective collapsed state to render — derived from preference, route, and any per-visit override. */
  collapsed: boolean
  toggle: () => void
}

const SidebarCollapseContext = createContext<SidebarCollapseState | null>(null)

// Reads the persisted preference on init. Guards against SSR (no `window`) and
// unavailable storage (privacy mode, disabled storage) by defaulting to expanded
// and logging rather than throwing.
function readPersistedCollapsed(): boolean {
  if (typeof window === 'undefined') return false

  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === 'true'
  } catch (error) {
    console.warn('SidebarCollapseContext: localStorage unavailable, defaulting collapsed to false', error)
    return false
  }
}

// Persists the preference. Guards against SSR/no-storage the same way as the
// initial read — never throws on the caller.
function persistCollapsed(next: boolean): void {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, String(next))
  } catch (error) {
    console.warn('SidebarCollapseContext: failed to persist collapsed', error)
  }
}

// Trip detail is /trips/<id> — deliberately excludes /trips/new (the create-trip
// form, a sibling path that matches the same shape but isn't a detail view).
function isTripDetailRoute(pathname: string): boolean {
  return /^\/trips\/[^/]+$/.test(pathname) && pathname !== ROUTES.tripNew
}

export function SidebarCollapseProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [preferredCollapsed, setPreferredCollapsed] = useState(readPersistedCollapsed)

  // Per-visit override: lets a dispatcher manually re-expand on a trip detail page
  // without touching their saved preference. Reset during render (not an effect)
  // when the route changes, so the reset lands in the same paint — no auto-collapse
  // flash-then-correct on navigation between trip detail pages.
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
