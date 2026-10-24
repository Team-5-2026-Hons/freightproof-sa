"use client"

import { createContext, useContext, useState, useCallback, useEffect, useMemo, useRef } from 'react'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseStatus } from '@shared/lib/types/phase'
import type { TripException, ExceptionType } from '@shared/lib/types/exception'
import type { VehicleId, VehicleType } from '@shared/lib/types/vehicle'
import { mockTrips } from '@shared/lib/mocks/trips'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { TRIP_POLL_INTERVAL_MS, UNASSIGNED_TRIP_POLL_INTERVAL_MS } from '@/lib/constants/app'
import { fetchMyActiveTrip, fetchMyTrip } from '@/lib/api/trips'
import { ApiError } from '@/lib/api/client'
import { isTripHandedOver } from '@/lib/api/driver-substitutions'
import { raiseException } from '@/lib/api/exceptions'
import { actionablePhase, contextPhaseEventId } from '@/lib/phase/derive'
import { useTripAutoRefresh } from '@/lib/hooks/useTripAutoRefresh'
import { actorGeneration, captureCustody, setCustodyContext } from '@/lib/session/custody-context'
import { useAccountGuard } from '@/lib/session/useAccountGuard'
import { AuthContext } from './AuthContext'
import { ToastContext } from './ToastContext'

// A trip in one of these states is finished — it can no longer be the trip the driver is
// working, so a pinned selection pointing at one is dropped. Mirrors the backend's
// `inactive` set in orchestration/trips/queries.py (get_active_trip_for_driver).
const TERMINAL_STATUSES: readonly Trip['status'][] = ['closed', 'cancelled']

// sessionStorage, not localStorage: a selection is a within-session intent ("I am
// starting THIS assignment now"), and it must not outlive the app being closed — a stale
// week-old selection resurfacing ahead of the server's own choice of current trip is
// exactly the confusion this whole change set out to fix.
const SELECTED_TRIP_KEY = 'fp.selectedTripId'

// Demo mode has no server to work out which vehicle a breakdown belongs to, so it
// mirrors what orchestration/exceptions/creation.py (pick_breakdown_vehicle) decides for a well-formed report:
// the truck, the trailer the driver named, or the trip's only trailer. The server's rules
// are the real ones; this only keeps the demo record shaped like a real one.
function demoBreakdownVehicleId(
  trip: Trip,
  type: ExceptionType,
  vehicleType: VehicleType | undefined,
  trailerId: string | undefined,
): VehicleId | null {
  if (type !== 'mechanical' || vehicleType === undefined) return null
  if (vehicleType === 'horse') return trip.horse?.id ?? null
  const named = trip.trailers.find((trailer) => String(trailer.id) === trailerId)
  if (named) return named.id
  const onlyTrailer = trip.trailers.length === 1 ? trip.trailers[0] : undefined
  return onlyTrailer?.id ?? null
}

function readSelectedTripId(): string | null {
  // Guarded for SSR/static-export prerender, where window does not exist.
  if (typeof window === 'undefined') return null
  return window.sessionStorage.getItem(SELECTED_TRIP_KEY)
}

// Mirrors lib/phase/derive.ts's RESOLVED_STATUSES by inversion (that constant is private
// to its module): only a row the ledger
// still considers open may be optimistically advanced. A phase the server has already
// called completed/exception/overridden is its own answer and must never be overwritten
// by a local guess.
const UNRESOLVED_PHASE_STATUSES: readonly PhaseStatus[] = ['pending', 'in_progress']

// What an optimistically advanced phase reads as until the server's real answer lands.
const OPTIMISTIC_PHASE_STATUS: PhaseStatus = 'completed'

/**
 * The trip as the driver's screens should see it while a phase submission is still in
 * flight: the addressed phase shown resolved, so Home does not re-offer the step the
 * driver has just finished swiping. Purely local and purely transient — it is never
 * persisted, never sent anywhere, and is replaced wholesale by `adoptTrip` the moment
 * the backend answers.
 */
function withOptimisticResolution(trip: Trip | null, syncingPhaseIds: readonly string[]): Trip | null {
  if (trip === null || syncingPhaseIds.length === 0) return trip

  const syncing = new Set<string>(syncingPhaseIds)
  let changed = false
  const phases = trip.phases.map((phase) => {
    if (!syncing.has(phase.phase_event_id) || !UNRESOLVED_PHASE_STATUSES.includes(phase.status)) {
      return phase
    }
    changed = true
    return { ...phase, status: OPTIMISTIC_PHASE_STATUS }
  })

  // Identity preserved when nothing was overridden, so consumers memoised on `trip`
  // don't re-run for a marker that changed nothing.
  return changed ? { ...trip, phases } : trip
}

export interface TripState {
  trip: Trip | null
  isLoading: boolean
  exceptions: TripException[]
  logException: (type: ExceptionType, payload: Record<string, unknown>) => Promise<void>
  refetchTrip: () => Promise<Trip | null>
  // Point the whole phase flow at one specific trip. Needed because the phase step pages
  // resolve which phase_event_id to submit from THIS context (they cannot take the trip
  // from the URL — output: 'export' can't enumerate trip UUIDs as path segments), so a
  // driver activating a chosen Upcoming trip must be able to make it the context trip
  // first. Without this, tapping "Activate" on the second of two assignments would
  // silently submit against whichever trip the server picked as current.
  selectTrip: (tripId: string) => Promise<Trip | null>
  // Adopt a trip the server just returned, without a second round trip to fetch it.
  // POST /phases/{id}/complete already responds with the full updated plan; before this
  // existed, every phase submit followed it with refetchTrip() purely because this
  // context had no way to be told what the caller already held — a whole extra request
  // on the slowest screen in the app, while the driver waited on the swipe.
  adoptTrip: (fresh: Trip) => void
  // Drop the selection and fall back to the server's choice (GET /trips/me/active).
  clearSelectedTrip: () => Promise<Trip | null>
  // phase_event_ids whose evidence is submitting in the background right now. `trip`
  // already shows them resolved (see withOptimisticResolution); this list is what lets a
  // screen say so honestly — "recording", not "recorded" — rather than silently
  // presenting an optimistic guess as a confirmed ledger row.
  syncingPhaseIds: readonly string[]
  // Optimistic advance: the driver has swiped and been sent back Home, and the
  // submission is running in lib/submission/phase-submitter.ts. Without this, Home would
  // re-derive currentPhase() from an untouched plan and immediately re-offer the step
  // they just finished.
  markPhaseSyncing: (phaseEventId: string) => void
  // Drop the marker. Called two ways, and the difference is what ran BEFORE it:
  // after adoptTrip(fresh) it reconciles (the server now says resolved, so the phase
  // stays resolved); on its own it ROLLS BACK (the phase returns to unresolved and the
  // driver can re-enter the step with their draft intact).
  clearPhaseSyncing: (phaseEventId: string) => void
  /** Refetch the trip WITHOUT touching isLoading. Never throws. No-op in demo mode. */
  refreshQuietly: () => Promise<void>
  /** True while a quiet refresh is in flight. For honest "checking…" UI only. */
  isRefreshing: boolean
  /** ISO timestamp of the last successful quiet refresh, or null if none yet. */
  lastRefreshedAt: string | null
  // The trip the server most recently told this driver they handed over (TRIP_HANDED_OVER),
  // so a screen can offer its participation history. Only the WORKING
  // context is dropped — nothing local is deleted and the trip is not presented as closed.
  handedOverTripId: string | null
  // A handover learned some other way (a completion notice, a live write's 409). Drops the
  // trip as working context and asks the server what this driver is on now.
  noteTripHandedOver: (tripId: string) => void
  dismissHandedOver: () => void
  // The trip dispatch ended while this driver was on it (cancelled, or stopped from an
  // incident). Only a dispatcher ever cancels a trip, so a cancelled working trip always
  // means "dispatch ended it". Deliberately carries no reason: after a hijacking this phone
  // may not be in the driver's hands, so it must never learn an incident was reported.
  endedByDispatch: EndedByDispatch | null
  dismissEndedByDispatch: () => void
  // The plan this driver just finished, snapshotted at the moment of the final hand-off.
  // A snapshot and not a `trip` read, because closing the trip removes it from
  // GET /trips/me/active — by the time the server confirms, there is nothing left to
  // render a completion screen from. See components/trip/TripCompleteOverlay.tsx.
  completedTrip: CompletedTrip | null
  noteTripCompleted: (completed: CompletedTrip) => void
  dismissTripCompleted: () => void
}

export interface CompletedTrip {
  tripId: string
  tripReference: string
  // Optimistic: the final phase's own row still shows its submission in flight, which is
  // what PhaseList renders honestly rather than claiming a receipt that has not landed.
  phases: readonly PhaseDescriptor[]
}

export interface EndedByDispatch {
  tripId: string
  tripReference: string
  endedAt: string | null
}

const ENDED_BY_DISPATCH_STATUS: Trip['status'] = 'cancelled'

function endedRecord(trip: Trip): EndedByDispatch {
  return { tripId: String(trip.id), tripReference: trip.trip_reference, endedAt: trip.closed_at }
}

export const TripContext = createContext<TripState | null>(null)

export function TripProvider({ children }: { children: React.ReactNode }) {
  const authCtx = useContext(AuthContext)
  // Account-local selections, optimistic phases and children must reset before a new
  // account can render them. Persistent evidence remains in its original local stores.
  return <AccountTripProvider key={`${authCtx?.user?.id ?? ''}:${actorGeneration()}`}>{children}</AccountTripProvider>
}

function AccountTripProvider({ children }: { children: React.ReactNode }) {
  const authCtx = useContext(AuthContext)
  const isCurrentAccount = useAccountGuard(authCtx?.user ? String(authCtx.user.id) : null)

  const mockTrip = useMemo(() => {
    if (!authCtx?.user) return null
    return (
      mockTrips.find(
        t => t.driver?.id === authCtx.user!.id && !['closed', 'cancelled'].includes(t.status),
      ) ?? null
    )
  }, [authCtx])

  // The plan exactly as the backend last stated it. Every consumer reads `trip` below
  // instead, which is this plus any in-flight optimistic advance — keeping the two apart
  // means a local guess can never be mistaken for, or written back as, the ledger.
  const [serverTrip, setServerTrip] = useState<Trip | null>(null)
  const custodySequence = serverTrip?.driver_access?.custody_sequence ?? serverTrip?.custody_sequence ?? null
  const [syncingPhases, setSyncingPhases] = useState<readonly { id: string; custodySequence: number | null }[]>([])
  // A server-confirmed transfer invalidates the old period's optimistic guesses, even
  // while the same account remains signed in and an old request has not settled yet.
  const syncingPhaseIds = useMemo(() => syncingPhases
    .filter(item => item.custodySequence === custodySequence).map(item => item.id), [syncingPhases, custodySequence])
  const trip = useMemo(
    () => withOptimisticResolution(serverTrip, syncingPhaseIds),
    [serverTrip, syncingPhaseIds],
  )
  const [isLoading, setIsLoading] = useState(!IS_DEMO_MODE)
  // Lazily seeded from sessionStorage so a mid-flow reload still addresses the trip the
  // driver chose. Returns null during static prerender (no window), which is harmless:
  // the first paint is the spinner either way.
  const [selectedTripId, setSelectedTripId] = useState<string | null>(() => readSelectedTripId())
  const [handedOverTripId, setHandedOverTripId] = useState<string | null>(null)
  const [endedByDispatch, setEndedByDispatch] = useState<EndedByDispatch | null>(null)
  const [completedTrip, setCompletedTrip] = useState<CompletedTrip | null>(null)
  // The last trip the server handed this phone as its working trip. When the server's own
  // pick stops returning it, this is the one to ask about: was it ended by dispatch?
  const workingTripIdRef = useRef<string | null>(null)

  // Publish who is signed in and which custody period the SERVER says this trip is
  // in, so every capture can stamp both at the moment it happens. Read from serverTrip, not
  // the optimistic trip: the period is the server's fact, never something this phone moves.
  // Set during render, not in an effect, on purpose: child effects run BEFORE this parent's,
  // and the offline queue's mount-time flush (a child) must already know who is signed in,
  // or it would hold every queued capture back as "not this driver's" until the next
  // foreground. The call is an idempotent assignment of values derived from this render.
  setCustodyContext({
    actorId: authCtx?.user ? String(authCtx.user.id) : null,
    tripId: serverTrip !== null ? String(serverTrip.id) : null,
    custodySequence: serverTrip?.driver_access?.custody_sequence ?? serverTrip?.custody_sequence ?? null,
  })

  const persistSelection = useCallback((tripId: string | null) => {
    if (typeof window !== 'undefined') {
      if (tripId === null) window.sessionStorage.removeItem(SELECTED_TRIP_KEY)
      else window.sessionStorage.setItem(SELECTED_TRIP_KEY, tripId)
    }
    setSelectedTripId(tripId)
  }, [])

  // The server's own pick no longer returns the trip this phone was working: ask once
  // whether dispatch ended it. A failed probe (offline, a handover's coded 409) is not
  // evidence of anything, so it says nothing and the next load starts fresh.
  const noticeEndedWorkingTrip = useCallback(async (active: Trip | null): Promise<void> => {
    const previous = workingTripIdRef.current
    workingTripIdRef.current = active !== null ? String(active.id) : null
    if (previous === null || (active !== null && String(active.id) === previous)) return
    try {
      const former = await fetchMyTrip(previous)
      if (isCurrentAccount() && former.status === ENDED_BY_DISPATCH_STATUS) setEndedByDispatch(endedRecord(former))
    } catch (err) {
      console.warn('Could not check how the previous trip ended', err)
    }
  }, [isCurrentAccount])

  // Which trip the flow is on: an explicit selection wins, otherwise the server's own
  // pick (GET /trips/me/active). Single resolver so refetchTrip and the mount effect can
  // never disagree about it.
  const loadTrip = useCallback(async (): Promise<Trip | null> => {
    if (!isCurrentAccount()) return null
    if (selectedTripId !== null) {
      try {
        const selected = await fetchMyTrip(selectedTripId)
        if (!isCurrentAccount()) return null
        if (!TERMINAL_STATUSES.includes(selected.status)) return selected
        // A finished trip is no longer "the trip I'm on" — drop the pin so the driver
        // isn't stranded on a closed trip, and let the server choose what's next. A trip
        // dispatch ended is said so, rather than vanishing from under the driver.
        if (selected.status === ENDED_BY_DISPATCH_STATUS) {
          setEndedByDispatch(endedRecord(selected))
          // Noticed here, so the active-trip fallback below does not ask about it again.
          workingTripIdRef.current = null
        }
        persistSelection(null)
      } catch (err) {
        if (!isCurrentAccount()) return null
        // 404 means the trip is no longer this driver's (reassigned, or never theirs) —
        // the selection is genuinely dead, so clear it. TRIP_HANDED_OVER is the coded 409 a
        // known former participant gets: also dead as WORKING context, but remembered so
        // the driver is pointed at their history rather than left wondering where it went.
        // Any other failure (offline, 5xx) is transient and must NOT silently strip a
        // selection mid-journey.
        if (err instanceof ApiError && err.status === 404) persistSelection(null)
        else if (isTripHandedOver(err)) {
          setHandedOverTripId(selectedTripId)
          persistSelection(null)
        } else throw err
      }
    }
    const active = await fetchMyActiveTrip()
    await noticeEndedWorkingTrip(active)
    return active
  }, [selectedTripId, persistSelection, isCurrentAccount, noticeEndedWorkingTrip])

  // refetchTrip is exposed for manual re-fetching after a phase submission. It's
  // deliberately not called directly inside the useEffect below — calling a setState-
  // containing callback synchronously from an effect causes cascading renders (same
  // anti-pattern AuthContext.tsx avoids); the effect inlines its own fetch instead.
  const refetchTrip = useCallback(async () => {
    if (!isCurrentAccount()) return null
    if (IS_DEMO_MODE) { setServerTrip(mockTrip); return mockTrip }
    if (!authCtx?.user) { setServerTrip(null); setIsLoading(false); return null }
    setIsLoading(true)
    try {
      const fetched = await loadTrip()
      if (!isCurrentAccount()) return null
      setServerTrip(fetched)
      return fetched
    } finally {
      if (isCurrentAccount()) setIsLoading(false)
    }
  }, [authCtx?.user, mockTrip, loadTrip, isCurrentAccount])

  // Pin the flow to one specific trip, then load it. Awaited by callers (the trip-detail
  // Activate button) so they only navigate once the phase flow is actually pointed at it.
  const selectTrip = useCallback(async (tripId: string): Promise<Trip | null> => {
    if (!isCurrentAccount()) return null
    if (IS_DEMO_MODE) { setServerTrip(mockTrip); return mockTrip }
    persistSelection(tripId)
    setIsLoading(true)
    try {
      const fetched = await fetchMyTrip(tripId)
      if (!isCurrentAccount()) return null
      setServerTrip(fetched)
      return fetched
    } finally {
      if (isCurrentAccount()) setIsLoading(false)
    }
  }, [mockTrip, persistSelection, isCurrentAccount])

  // Deliberately not a setter for arbitrary state: it takes a server response only, so
  // the context can never drift into a locally-invented trip. The phase flow's own
  // sequencing guard reads trip.phases from here, and it must only ever reflect what the
  // ledger actually says.
  const adoptTrip = useCallback((fresh: Trip) => {
    if (!isCurrentAccount()) return
    setServerTrip(fresh)
    setIsLoading(false)
  }, [isCurrentAccount])

  const markPhaseSyncing = useCallback((phaseEventId: string) => {
    if (!isCurrentAccount()) return
    setSyncingPhases(previous => previous.some(item => item.id === phaseEventId && item.custodySequence === custodySequence)
      ? previous : [...previous, { id: phaseEventId, custodySequence }])
  }, [custodySequence, isCurrentAccount])

  const clearPhaseSyncing = useCallback((phaseEventId: string) => {
    if (!isCurrentAccount()) return
    setSyncingPhases(previous => previous.filter(item => item.id !== phaseEventId || item.custodySequence !== custodySequence))
  }, [custodySequence, isCurrentAccount])

  const clearSelectedTrip = useCallback(async (): Promise<Trip | null> => {
    if (!isCurrentAccount()) return null
    if (IS_DEMO_MODE) { setServerTrip(mockTrip); return mockTrip }
    persistSelection(null)
    setIsLoading(true)
    try {
      const fetched = await fetchMyActiveTrip()
      if (!isCurrentAccount()) return null
      setServerTrip(fetched)
      return fetched
    } finally {
      if (isCurrentAccount()) setIsLoading(false)
    }
  }, [mockTrip, persistSelection, isCurrentAccount])

  // Optional: TripContext.test.tsx / TripContext.real.test.tsx render TripProvider
  // without a ToastProvider ancestor, and useToast() throws outside one. Reading the
  // context directly (rather than that hook) keeps the unblock toast below a no-op in
  // those harnesses instead of a hard crash, while still firing for real once mounted in
  // the real app tree, which does put TripProvider inside the root ToastProvider.
  const toastCtx = useContext(ToastContext)

  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)

  // Distinct from refetchTrip: this must never set isLoading (see useTripAutoRefresh.ts —
  // six screens blank to a spinner on that flag, and a poll must never flash them). Writes
  // serverTrip only, never `trip` directly, so withOptimisticResolution keeps re-layering
  // syncingPhaseIds on top of whatever this fetch returns — a poll landing mid-submission
  // must not un-complete a phase the driver just swiped.
  const refreshQuietly = useCallback(async (): Promise<void> => {
    // No server to ask in demo mode — mirrors every other IS_DEMO_MODE branch above.
    if (IS_DEMO_MODE) return
    if (!authCtx?.user || !isCurrentAccount()) return

    setIsRefreshing(true)
    try {
      const fetched = await loadTrip()
      if (!isCurrentAccount()) return
      setServerTrip(fetched)
      setLastRefreshedAt(new Date().toISOString())
      // The unblock toast is deliberately NOT raised here — see the gate-transition effect
      // below for why it has to watch the rendered plan instead of this one fetch.
    } catch (err) {
      if (!isCurrentAccount()) return
      // Never surfaced as a toast or rethrown — useTripAutoRefresh's interval and
      // foreground listeners call this directly, and a rejection reaching them every poll
      // tick while a blocked driver has no signal would be its own kind of harassment.
      // Logged so the failure is still visible in devtools/telemetry.
      console.error('Quiet trip refresh failed', err)
    } finally {
      if (isCurrentAccount()) setIsRefreshing(false)
    }
  }, [authCtx?.user, loadTrip, isCurrentAccount])

  const noteTripHandedOver = useCallback((tripId: string) => {
    if (!isCurrentAccount()) return
    setHandedOverTripId(tripId)
    // A changed selection re-runs the mount effect's load on its own; only a trip that came
    // from the server's own pick (no pin) needs an explicit refresh.
    if (selectedTripId === tripId) {
      persistSelection(null)
      setServerTrip(null)
    } else if (serverTrip !== null && String(serverTrip.id) === tripId) {
      // Cleared first so the former trip's live actions disappear immediately, rather than
      // staying tappable for however long the refresh takes to answer.
      setServerTrip(null)
      void refreshQuietly()
    }
  }, [selectedTripId, serverTrip, persistSelection, refreshQuietly, isCurrentAccount])

  const dismissHandedOver = useCallback(() => setHandedOverTripId(null), [])
  const dismissEndedByDispatch = useCallback(() => setEndedByDispatch(null), [])

  const noteTripCompleted = useCallback((completed: CompletedTrip) => {
    if (!isCurrentAccount()) return
    setCompletedTrip(completed)
  }, [isCurrentAccount])

  // Closing the completion screen is also the moment to ask what this driver is on now:
  // the finished trip has left /trips/me/active, so Home needs a refresh to offer the
  // next assignment instead of an empty state. Quiet, so Home does not flash a spinner.
  const dismissTripCompleted = useCallback(() => {
    setCompletedTrip(null)
    void refreshQuietly()
  }, [refreshQuietly])

  // Every path that adopts a trip (selection, adoption after a submit, a refresh) names the
  // working trip here, so the next load can tell when the server stops returning it.
  useEffect(() => {
    if (serverTrip !== null) workingTripIdRef.current = String(serverTrip.id)
  }, [serverTrip])

  // Derived fresh every render from `trip` (never cached) — the whole point is that this
  // must flip false the instant the server's own recomputation says so.
  const actionable = trip !== null ? actionablePhase(trip.phases) : null

  // A driver with no trip is waiting to be given one, and nothing else on Home will tell
  // them it arrived: the foreground refresh fires when the app comes BACK, and a phone
  // propped on the dash never leaves the foreground. Until this arm existed, the only way
  // to see a new assignment was to kill and relaunch the app, which is exactly what a
  // driver had to do. It also recovers a Home whose first load failed and
  // left `trip` null, which otherwise reads as "No trip assigned" until the next launch.
  //
  // Gated on isLoading so the hook's leading-edge refresh does not duplicate the mount
  // effect's own first load, and on demo mode because refreshQuietly is a no-op there.
  const hasNoTrip = trip === null && !isLoading && !IS_DEMO_MODE
  // `?? null` first is mandatory: `blocked_on` is optional on the shared PhaseDescriptor
  // type, so `undefined !== null` would be permanently true and polling would never turn
  // off. Mirrors the exact guard in Linehaul.tsx (`isBlocked`) — match its style.
  const pollingEnabled =
    hasNoTrip ||
    (trip !== null && ((actionable?.blocked_on ?? null) !== null || trip.status === 'exception_hold'))

  useTripAutoRefresh({
    pollingEnabled,
    // See UNASSIGNED_TRIP_POLL_INTERVAL_MS: waiting for an assignment is a slower
    // question than waiting on a gate the driver is standing at.
    intervalMs: hasNoTrip ? UNASSIGNED_TRIP_POLL_INTERVAL_MS : TRIP_POLL_INTERVAL_MS,
    onRefresh: refreshQuietly,
  })

  // The unblock toast watches the RENDERED plan rather than living inside refreshQuietly,
  // because a quiet poll is not the only thing that can close a gate: the 409 handler's
  // refetchTrip, adoptTrip after a submit, and selectTrip when the driver switches
  // assignment all replace the trip too. A refresh-local ref went stale on those paths and
  // then fired "the warehouse has finished" at a driver who had merely opened their other
  // trip. Keying the remembered value off the actionable phase's IDENTITY as well as its
  // gate is what fixes that: a different phase (or a different trip) re-seeds instead of
  // reading as this phase clearing.
  const actionablePhaseEventId = actionable !== null ? String(actionable.phase_event_id) : null
  const actionableBlockedOn = actionable?.blocked_on ?? null
  const previousGateRef = useRef<{ phaseEventId: string | null; blockedOn: string | null } | null>(null)

  useEffect(() => {
    const previous = previousGateRef.current
    previousGateRef.current = { phaseEventId: actionablePhaseEventId, blockedOn: actionableBlockedOn }

    // First observation seeds only — a trip that loads already unblocked never transitioned.
    if (previous === null) return
    // A different phase, or a different trip, is a new subject rather than this one clearing.
    if (previous.phaseEventId !== actionablePhaseEventId) return
    if (previous.blockedOn === null || actionableBlockedOn !== null) return

    // notify() is an event sink, not derived state — this is deliberately not the
    // setState-in-effect pattern the rest of this file avoids. Worth saying out loud
    // because the card clears silently otherwise, and a driver who looked away for a
    // minute has no way to tell the screen became actionable.
    toastCtx?.notify({
      kind: 'info',
      title: 'You can continue',
      body: 'The warehouse has finished. This step is ready.',
    })
  }, [actionablePhaseEventId, actionableBlockedOn, toastCtx])

  useEffect(() => {
    // No synchronous setState here, even for the IS_DEMO_MODE/no-user branches —
    // matches AuthContext.tsx's mount effect, which only ever calls setState from
    // inside a .then() callback to avoid the cascading-render anti-pattern.
    if (IS_DEMO_MODE) {
      Promise.resolve().then(() => { if (isCurrentAccount()) setServerTrip(mockTrip) })
      return
    }
    if (!authCtx?.user) {
      Promise.resolve().then(() => { if (isCurrentAccount()) { setServerTrip(null); setIsLoading(false) } })
      return
    }

    Promise.resolve().then(() => { if (isCurrentAccount()) setIsLoading(true) })
    loadTrip()
      .then(fetched => { if (isCurrentAccount()) setServerTrip(fetched) })
      // Previously uncaught: a rejected fetch here (offline, 5xx) became an unhandled
      // rejection and left isLoading stuck true, which reads as a frozen screen. Log and
      // leave trip null so the "no active trip" state renders instead of a dead spinner.
      .catch((err: unknown) => {
        if (!isCurrentAccount()) return
        console.error('Failed to load the driver\'s current trip', err)
        setServerTrip(null)
      })
      .finally(() => { if (isCurrentAccount()) setIsLoading(false) })
  }, [authCtx?.user, mockTrip, loadTrip, isCurrentAccount])

  const [exceptions, setExceptions] = useState<TripException[]>([])
  // Track which trip's initial state we've applied — avoids the useEffect + setState anti-pattern.
  // When a new trip loads, reset derived state synchronously during render (React docs recommended).
  const [syncedTripId, setSyncedTripId] = useState<string | null>(null)

  if (trip !== null && (trip.id as string) !== syncedTripId) {
    setSyncedTripId(trip.id as string)
    setExceptions(trip.exceptions)
  }

  const logException = useCallback(async (type: ExceptionType, payload: Record<string, unknown>) => {
    if (!trip) return
    const description = typeof payload.description === 'string' ? payload.description : ''
    // The page uploads every photo first and hands over the COMPLETE ordered id list; the
    // first id also rides in the single field so an older backend still gets the lead photo.
    const photoIds = Array.isArray(payload.supporting_artifact_ids)
      ? payload.supporting_artifact_ids.filter((id): id is string => typeof id === 'string')
      : []
    const supportingArtifactId = photoIds[0]
    const clientReportId = typeof payload.clientReportId === 'string'
      ? payload.clientReportId
      : crypto.randomUUID()
    // The panic page captures a GPS fix and promises the driver it will be included —
    // extract it here so it actually reaches the backend instead of being dropped.
    // Both-or-neither: the backend's DriverExceptionCreateBody validator 422s a
    // partial fix, so a lone axis (or a non-number) is treated as no fix at all.
    const gpsLat = typeof payload.gpsLat === 'number' ? payload.gpsLat : undefined
    const gpsLng = typeof payload.gpsLng === 'number' ? payload.gpsLng : undefined
    const hasGpsFix = gpsLat !== undefined && gpsLng !== undefined
    // The page owns this timestamp: forwarding it unchanged keeps an offline report's
    // comparison tied to the original phone capture rather than its later API flush.
    const driverCapturedAt = typeof payload.driverCapturedAt === 'string'
      ? payload.driverCapturedAt
      : undefined
    const driverAccuracyMetres = typeof payload.driverAccuracyMetres === 'number'
      ? payload.driverAccuracyMetres
      : undefined
    // The driver's "truck or trailer" answer on a breakdown (LogExceptionPageClient).
    // Only the two real kinds pass; anything else goes as no answer, which the server
    // records as no vehicle rather than rejecting the report.
    const rawVehicleType = payload.vehicleType
    const vehicleType: VehicleType | undefined =
      rawVehicleType === 'horse' || rawVehicleType === 'trailer' ? rawVehicleType : undefined
    const trailerId = typeof payload.trailerId === 'string' ? payload.trailerId : undefined

    // WHERE this happened, stamped at the moment it happened. Read off `trip` — the
    // OPTIMISTIC plan, not serverTrip — on purpose: a driver who swiped departure three
    // seconds ago is on the road, and the exception belongs to that leg even though the
    // submission is still in flight.
    const phaseEventId = contextPhaseEventId(trip.phases)

    if (IS_DEMO_MODE) {
      // seal_mismatch and seal_compromised are both system-raised (advance_arrival's own
      // comparison), never passed here by a driver action — this app only ever calls
      // logException with 'panic_button' or a DRIVER_EXCEPTION_TYPES pick, and neither
      // seal type is offered on that picker (status-meta.ts). Both stay listed anyway,
      // for the same reason: CRITICAL is this codebase's alarm tier (phase_service.py's
      // own comment) — "the number differs" (seal_mismatch) and "the seal is broken or
      // missing" (seal_compromised) are both findings with no benign reading, exactly
      // like seal_broken_in_transit and panic_button. Keeping them paired here means a
      // future caller that DOES reach this branch with either type gets the right
      // severity by construction, rather than by remembering to update this list twice.
      const criticalTypes: ExceptionType[] = [
        'panic_button', 'seal_broken_in_transit', 'seal_mismatch', 'seal_compromised',
      ]
      const newExc: TripException = {
        id: crypto.randomUUID() as unknown as TripException['id'],
        trip_id: trip.id, exception_type: type, source: 'driver',
        severity: criticalTypes.includes(type) ? 'critical' : 'warning',
        description,
        // Same tagging the real branch sends, so demo mode exercises the shape the
        // dispatcher timeline reads rather than the untagged one it has to guess at.
        phase_event_id: phaseEventId, checkpoint_id: null, supporting_artifact_id: null,
        // Mirror the real branch so demo mode exercises the same shape the
        // dispatcher UI will eventually read: a coordinate pair or null, never one axis.
        gps_lat: hasGpsFix ? gpsLat : null,
        gps_lng: hasGpsFix ? gpsLng : null,
        vehicle_id: demoBreakdownVehicleId(trip, type, vehicleType, trailerId),
        // Mirrors backend initial_review_status: every exception starts needs_review,
        // whatever its severity, so demo mode matches the real backend path.
        review_status: 'needs_review',
        review_outcome: null, reviewed_by_user_id: null,
        reviewed_at: null, review_note: null, contact_method: null,
        merkle_batch_id: null,
        claimed_by_user_id: null, claimed_at: null, claimed_by_name: null, reviewed_by_name: null,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }
      setExceptions(prev => [...prev, newExc])
      return
    }

    // A caller that stamped the custody period at capture (the exception page, before its
    // GPS wait) passes it in; anything else is captured right here, at the driver's tap.
    const custodyAtCapture = typeof payload.custodySequence === 'number'
      ? payload.custodySequence
      : captureCustody(String(trip.id)).custodySequence
    const created = await raiseException(String(trip.id), {
      exception_type: type, description, supporting_artifact_id: supportingArtifactId,
      ...(custodyAtCapture !== null ? { custody_sequence: custodyAtCapture } : {}),
      ...(photoIds.length > 0 ? { supporting_artifact_ids: photoIds } : {}),
      client_report_id: clientReportId,
      ...(phaseEventId ? { phase_event_id: String(phaseEventId) } : {}),
      ...(vehicleType ? { vehicle_type: vehicleType } : {}),
      ...(trailerId ? { trailer_id: trailerId } : {}),
      gps_lat: hasGpsFix ? gpsLat : undefined,
      gps_lng: hasGpsFix ? gpsLng : undefined,
      driver_captured_at: driverCapturedAt,
      driver_accuracy_metres: driverAccuracyMetres,
    })
    setExceptions(prev => [...prev, created])
  }, [trip])

  return (
    <TripContext.Provider
      value={{
        trip, isLoading, exceptions,
        logException, refetchTrip,
        selectTrip, clearSelectedTrip, adoptTrip,
        syncingPhaseIds, markPhaseSyncing, clearPhaseSyncing,
        refreshQuietly, isRefreshing, lastRefreshedAt,
        handedOverTripId, noteTripHandedOver, dismissHandedOver,
        endedByDispatch, dismissEndedByDispatch,
        completedTrip, noteTripCompleted, dismissTripCompleted,
      }}
    >
      {children}
    </TripContext.Provider>
  )
}
