'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { getCrewAvailability } from '@/lib/api/client'
import { busyById, NOBODY_BUSY, type AvailabilityWindow, type BusyById } from '@/lib/trips/crew-availability'

/** idle: no complete window to ask about yet. error: the read failed; the server still guards. */
export type AvailabilityStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface UseCrewAvailabilityResult {
  status: AvailabilityStatus
  busy: BusyById
  /** Ask again for the same window, e.g. after a create lost a race (409 CREW_UNAVAILABLE). */
  refetch: () => void
}

// Typing a time fires a change per keystroke. Wait for the dispatcher to pause before asking.
export const AVAILABILITY_DEBOUNCE_MS = 400

/** An answer remembers the window it was for. One for any other window is stale, so status
 *  and busy are derived from whether it matches, never reset by hand. */
type Answer = { key: string; ok: true; busy: BusyById } | { key: string; ok: false }

function windowKey(window: AvailabilityWindow): string {
  return `${window.startIso}/${window.endIso}`
}

/** Who is busy in the wizard's chosen window (FP-142). Read-only. */
export function useCrewAvailability(window: AvailabilityWindow | null): UseCrewAvailabilityResult {
  const [answer, setAnswer] = useState<Answer | null>(null)
  // Each request takes a ticket, and only the newest may write. A slow answer for the old
  // times must not grey out options for the new ones.
  const ticket = useRef(0)
  const startIso = window?.startIso ?? null
  const endIso = window?.endIso ?? null

  const load = useCallback(async (start: string, end: string): Promise<void> => {
    const mine = ++ticket.current
    const key = windowKey({ startIso: start, endIso: end })
    try {
      const reply = await getCrewAvailability(start, end)
      if (mine === ticket.current) setAnswer({ key, ok: true, busy: busyById(reply.busy) })
    } catch (err) {
      // A screen state, not a crash: the dispatcher can still create, and the server refuses a clash.
      console.warn('Crew availability check failed', err)
      if (mine === ticket.current) setAnswer({ key, ok: false })
    }
  }, [])

  useEffect(() => {
    if (startIso === null || endIso === null) return
    const timer = setTimeout(() => { void load(startIso, endIso) }, AVAILABILITY_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [startIso, endIso, load])

  const refetch = useCallback((): void => {
    if (startIso !== null && endIso !== null) void load(startIso, endIso)
  }, [startIso, endIso, load])

  if (startIso === null || endIso === null) return { status: 'idle', busy: NOBODY_BUSY, refetch }
  if (answer?.key !== windowKey({ startIso, endIso })) return { status: 'loading', busy: NOBODY_BUSY, refetch }
  return answer.ok
    ? { status: 'ready', busy: answer.busy, refetch }
    : { status: 'error', busy: NOBODY_BUSY, refetch }
}
