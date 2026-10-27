"use client"

// The driver's pending substitution arrangements and unread handover notices, loaded
// separately from TripContext. A driver with NO current trip can still be the incoming driver
// on someone else's — so this must not hang off TripContext's current-trip polling, which
// only runs while a trip is loaded and blocked.
//
// One provider in the authenticated (app) layout, so there is exactly one timer however many
// screens read it. Refresh moments: mount, app foreground, reconnect, and a bounded interval
// while the app is visible (useTripAutoRefresh owns all of that, including the offline skip
// and single-flight guard). Background push is outside v1, so this is the delivery path.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type {
  SubstitutionNoticeRead,
  SubstitutionRequestRead,
  SubstitutionRole,
} from '@shared/lib/types/driver-substitution'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { TRIP_POLL_INTERVAL_MS } from '@/lib/constants/app'
import {
  fetchDriverSubstitutions,
  fetchSubstitutionNotices,
  markSubstitutionNoticeRead,
} from '@/lib/api/driver-substitutions'
import { useTripAutoRefresh } from '@/lib/hooks/useTripAutoRefresh'
import { flushSubstitutionCaptures } from '@/lib/hooks/useSubstitutionCapture'
import { substitutionRoleFor } from '@/lib/utils/driver-substitution'
import { useAccountGuard } from '@/lib/session/useAccountGuard'
import { AuthContext } from './AuthContext'
import { TripContext } from './TripContext'

export interface DriverSubstitutionState {
  pending: SubstitutionRequestRead[]
  notices: SubstitutionNoticeRead[]
  isLoading: boolean
  loadError: string | null
  lastRefreshedAt: string | null
  refresh: () => Promise<void>
  /** Hides the notice once the server records it read. Never a handover confirmation. */
  markNoticeRead: (noticeId: string) => Promise<void>
}

export const DriverSubstitutionContext = createContext<DriverSubstitutionState | null>(null)

const LOAD_ERROR = 'Could not check for driver handovers. The app will try again automatically.'

function isAppHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function DriverSubstitutionProvider({ children }: { children: React.ReactNode }) {
  const authCtx = useContext(AuthContext)
  const tripCtx = useContext(TripContext)
  const driverId = authCtx?.user?.id !== undefined ? String(authCtx.user.id) : null
  const enabled = !IS_DEMO_MODE && driverId !== null
  const isCurrentAccount = useAccountGuard(driverId)

  const [pending, setPending] = useState<SubstitutionRequestRead[]>([])
  const [notices, setNotices] = useState<SubstitutionNoticeRead[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)

  const roleByRequestRef = useRef(new Map<string, SubstitutionRole>())
  const currentTripIdRef = useRef<string | null>(null)
  currentTripIdRef.current = tripCtx?.trip !== null && tripCtx?.trip !== undefined ? String(tripCtx.trip.id) : null
  const handledCompletionsRef = useRef(new Set<string>())

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || driverId === null || !isCurrentAccount()) return
    if (isAppHidden()) return

    await flushSubstitutionCaptures()
    if (!isCurrentAccount()) return

    const [pendingResult, noticeResult] = await Promise.allSettled([
      fetchDriverSubstitutions(),
      fetchSubstitutionNotices(),
    ])
    if (!isCurrentAccount()) return
    if (pendingResult.status === 'fulfilled') {
      for (const request of pendingResult.value) {
        const role = substitutionRoleFor(request, driverId)
        if (role !== null) roleByRequestRef.current.set(request.id, role)
      }
      setPending(pendingResult.value)
    }
    if (noticeResult.status === 'fulfilled') setNotices(noticeResult.value)

    const failures = [pendingResult, noticeResult].filter((r) => r.status === 'rejected')
    if (failures.length > 0) {
      for (const failure of failures) console.error('Driver substitution refresh failed', failure.reason)
      setLoadError(LOAD_ERROR)
    } else {
      setLoadError(null)
      setLastRefreshedAt(new Date().toISOString())
    }
    setIsLoading(false)
  }, [enabled, driverId, isCurrentAccount])

  useTripAutoRefresh({ pollingEnabled: enabled, intervalMs: TRIP_POLL_INTERVAL_MS, onRefresh: refresh })

  const noteTripHandedOver = tripCtx?.noteTripHandedOver
  const refreshTripQuietly = tripCtx?.refreshQuietly
  useEffect(() => {
    for (const notice of notices) {
      if (notice.kind !== 'completed' || handledCompletionsRef.current.has(notice.id)) continue
      handledCompletionsRef.current.add(notice.id)
      const role = roleByRequestRef.current.get(notice.request_id)
      if (role === 'outgoing' || (role === undefined && currentTripIdRef.current === notice.trip_id)) {
        noteTripHandedOver?.(notice.trip_id)
      } else {
        void refreshTripQuietly?.()
      }
    }
  }, [notices, noteTripHandedOver, refreshTripQuietly])

  const [loadedFor, setLoadedFor] = useState<string | null>(driverId)
  if (loadedFor !== driverId) {
    setLoadedFor(driverId)
    setPending([])
    setNotices([])
    setLoadError(null)
    setLastRefreshedAt(null)
    setIsLoading(enabled)
    roleByRequestRef.current = new Map()
    handledCompletionsRef.current = new Set()
  }

  const markNoticeRead = useCallback(async (noticeId: string): Promise<void> => {
    if (!enabled || !isCurrentAccount()) return
    await markSubstitutionNoticeRead(noticeId)
    if (!isCurrentAccount()) return
    setNotices((prev) => prev.filter((notice) => notice.id !== noticeId))
  }, [enabled, isCurrentAccount])

  return (
    <DriverSubstitutionContext.Provider
      value={{ pending, notices, isLoading, loadError, lastRefreshedAt, refresh, markNoticeRead }}
    >
      {children}
    </DriverSubstitutionContext.Provider>
  )
}
