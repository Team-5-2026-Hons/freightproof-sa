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
  /** Pending arrangements naming this driver, incoming or outgoing. */
  pending: SubstitutionRequestRead[]
  /** Unread notices, newest first as the server sends them. */
  notices: SubstitutionNoticeRead[]
  /** True only until the first answer — a refresh never flashes the screen back to loading. */
  isLoading: boolean
  /** The last refresh failed. Earlier data is kept on screen rather than blanked. */
  loadError: string | null
  lastRefreshedAt: string | null
  refresh: () => Promise<void>
  /** Hides the notice once the server records it read. Never a handover confirmation. */
  markNoticeRead: (noticeId: string) => Promise<void>
}

export const DriverSubstitutionContext = createContext<DriverSubstitutionState | null>(null)

// No manual retry is offered: the next foreground, reconnect or interval tries again on its own.
const LOAD_ERROR = 'Could not check for driver handovers. The app will try again automatically.'

function isAppHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

export function DriverSubstitutionProvider({ children }: { children: React.ReactNode }) {
  const authCtx = useContext(AuthContext)
  // Optional for the same reason TripContext reads ToastContext directly: test harnesses
  // render this without the full app tree. In the real layout TripProvider is always above.
  const tripCtx = useContext(TripContext)
  const driverId = authCtx?.user?.id !== undefined ? String(authCtx.user.id) : null
  const enabled = !IS_DEMO_MODE && driverId !== null
  const isCurrentAccount = useAccountGuard(driverId)

  const [pending, setPending] = useState<SubstitutionRequestRead[]>([])
  const [notices, setNotices] = useState<SubstitutionNoticeRead[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)

  // The role this driver held on each arrangement seen while it was pending. A 'completed'
  // notice carries only ids, and by then the request is no longer in the pending list —
  // remembering the role is what lets an outgoing driver's working trip be dropped at once.
  const roleByRequestRef = useRef(new Map<string, SubstitutionRole>())
  // Completed notices already acted on, so a notice that stays unread across many polls
  // triggers one trip refresh, not one per tick.
  const handledCompletionsRef = useRef(new Set<string>())

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled || driverId === null || !isCurrentAccount()) return
    // The interval keeps ticking while a browser tab is hidden; there is nobody to show the
    // answer to. The foreground listener refreshes the moment the app is visible again.
    if (isAppHidden()) return

    // A confirmation pressed while offline (or whose answer was lost) is resent here, on the
    // same refresh moments, before the list is read — so the list shows the server's answer.
    await flushSubstitutionCaptures()
    if (!isCurrentAccount()) return

    // Settled separately: a failed notice read must not hide an arrangement that did load.
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
      // Logged, never toasted: this runs on a timer, and a driver without signal would be
      // told about it every interval.
      for (const failure of failures) console.error('Driver substitution refresh failed', failure.reason)
      setLoadError(LOAD_ERROR)
    } else {
      setLoadError(null)
      setLastRefreshedAt(new Date().toISOString())
    }
    setIsLoading(false)
  }, [enabled, driverId, isCurrentAccount])

  useTripAutoRefresh({ pollingEnabled: enabled, intervalMs: TRIP_POLL_INTERVAL_MS, onRefresh: refresh })

  // A completed handover changes which trip this driver is working, so the trip context must
  // catch up now rather than at its own next poll (which may never come — it only polls while
  // blocked). Watches state, not the fetch, so it runs once per notice whatever loaded it.
  const noteTripHandedOver = tripCtx?.noteTripHandedOver
  const refreshTripQuietly = tripCtx?.refreshQuietly
  useEffect(() => {
    for (const notice of notices) {
      if (notice.kind !== 'completed' || handledCompletionsRef.current.has(notice.id)) continue
      handledCompletionsRef.current.add(notice.id)
      if (roleByRequestRef.current.get(notice.request_id) === 'outgoing') {
        noteTripHandedOver?.(notice.trip_id)
      } else {
        // Incoming, or a role this session never saw: the server decides. A pinned former
        // trip answers TRIP_HANDED_OVER and TripContext drops it; a new current trip loads.
        void refreshTripQuietly?.()
      }
    }
  }, [notices, noteTripHandedOver, refreshTripQuietly])

  // Signing out (or a different driver signing in) must not leave the previous driver's
  // arrangements on screen. Reset during render on the id change, not in an effect.
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
    // Removed only after the server records it: a notice that silently reappears on the next
    // poll would read as a new handover. A failure leaves it visible and rethrows for the UI.
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
