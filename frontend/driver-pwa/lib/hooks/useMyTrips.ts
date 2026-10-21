'use client'

// The signed-in driver's own trips, every status — GET /trips/me, or the mock fixtures in
// demo mode. One source for the Trips tabs and Home's record, so the two can never disagree
// about what the driver has done.
//
// One STORE for every reader. Home mounts two readers (its record and NowCard's place
// names), each step screen another, and each used to issue its own GET /trips/me — the
// slowest request on a slow backend, repeated on every screen. Readers now share one
// in-flight request and one cached answer: a screen that already has the list renders it
// at once and refreshes it in the background when it is older than STALE_AFTER_MS.

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { mockTrips } from '@shared/lib/mocks/trips'
import { IS_DEMO_MODE } from '@/lib/constants/env'
import { useAuth } from '@/lib/hooks/useAuth'
import { fetchMyTrips } from '@/lib/api/trips'
import type { DriverTripSummary } from '@/lib/types/driver-trip'
import { tripsForDriver } from '@/lib/utils/trip-filters'

// Demo mode has no backend to call, so its rows are projected from the mock fixtures into
// the same DriverTripSummary shape the real endpoint returns — one row type downstream,
// so the tabs and filters below never branch on where the data came from.
function demoTripsFor(driverId: string): DriverTripSummary[] {
  return tripsForDriver(mockTrips, driverId as Parameters<typeof tripsForDriver>[1]).map((t) => ({
    id: t.id,
    trip_reference: t.trip_reference,
    status: t.status,
    trip_type: t.trip_type,
    origin_precinct_id: t.origin_precinct_id,
    destination_precinct_id: t.destination_precinct_id,
    origin_precinct_name: null,
    destination_precinct_name: null,
    planned_departure_at: t.planned_departure_at,
    actual_departure_at: t.actual_departure_at,
    planned_arrival_at: t.planned_arrival_at,
    actual_arrival_at: t.actual_arrival_at,
    // Unreviewed critical rows only, matching the backend's needs_review_count: every
    // exception starts needs_review, but the driver cannot review any of them.
    needs_review_count: t.exceptions.filter(
      (e) => e.review_status === 'needs_review' && e.severity === 'critical',
    ).length,
    created_at: t.created_at,
    updated_at: t.updated_at,
  }))
}

export interface MyTrips {
  trips: DriverTripSummary[]
  isLoading: boolean
  loadError: string | null
  /** Re-fetch, e.g. from a "Try Again" button. */
  reload: () => void
}

// A list this old is refreshed in the background on the next mount; younger ones are
// served as they are. Matches the trip poll so Home and Trips never show staler data than
// the working trip does.
export const STALE_AFTER_MS = 15_000
const LOAD_ERROR = 'Could not load your trips. Check your connection and try again.'
const NO_TRIPS: DriverTripSummary[] = []

interface TripsSnapshot {
  /** The driver this snapshot belongs to; readers for anyone else see an empty list. */
  driverId: string | null
  trips: DriverTripSummary[]
  /** Null until the first answer for this driver has landed (success or failure). */
  fetchedAt: number | null
  isLoading: boolean
  loadError: string | null
}

interface TripsStore {
  snapshot: TripsSnapshot
  inflight: Promise<void> | null
  listeners: Set<() => void>
}

function emptySnapshot(driverId: string | null): TripsSnapshot {
  return { driverId, trips: NO_TRIPS, fetchedAt: null, isLoading: false, loadError: null }
}

const store: TripsStore = { snapshot: emptySnapshot(null), inflight: null, listeners: new Set() }

function publish(next: TripsSnapshot): void {
  store.snapshot = next
  for (const listener of store.listeners) listener()
}

// A different driver signing in must never see the previous driver's list, so the store
// is keyed by driver and dropped (not merged) when the id changes. An answer still in
// flight for the old driver is ignored when it lands.
function bindDriver(driverId: string | null): void {
  if (store.snapshot.driverId === driverId) return
  store.inflight = null
  publish(emptySnapshot(driverId))
}

function isFresh(snapshot: TripsSnapshot, now: number): boolean {
  return snapshot.fetchedAt !== null && snapshot.loadError === null && now - snapshot.fetchedAt < STALE_AFTER_MS
}

/** One request at a time per driver; every concurrent caller awaits the same one. */
function load(driverId: string, { force }: { force: boolean }): Promise<void> {
  bindDriver(driverId)
  if (store.inflight !== null) return store.inflight
  if (!force && isFresh(store.snapshot, Date.now())) return Promise.resolve()
  // Stale data stays on screen while it refreshes; only a first load shows as loading.
  publish({ ...store.snapshot, isLoading: store.snapshot.fetchedAt === null, loadError: null })
  const request = fetchMyTrips()
    .then((trips) => {
      if (store.snapshot.driverId !== driverId) return
      publish({ driverId, trips, fetchedAt: Date.now(), isLoading: false, loadError: null })
    })
    // Surfaced, never swallowed: an empty list and a failed fetch look identical
    // otherwise, and "no upcoming trips" is a lie when the request simply didn't land.
    .catch((err: unknown) => {
      console.error('Failed to load the driver\'s trips', err)
      if (store.snapshot.driverId !== driverId) return
      publish({ ...store.snapshot, fetchedAt: Date.now(), isLoading: false, loadError: LOAD_ERROR })
    })
    .finally(() => {
      if (store.inflight === request) store.inflight = null
    })
  store.inflight = request
  return request
}

function subscribe(listener: () => void): () => void {
  store.listeners.add(listener)
  return () => { store.listeners.delete(listener) }
}

function getSnapshot(): TripsSnapshot {
  return store.snapshot
}

export function __resetMyTripsStoreForTests(): void {
  store.inflight = null
  store.snapshot = emptySnapshot(null)
  store.listeners.clear()
}

export function useMyTrips(): MyTrips {
  const { user } = useAuth()
  // Keyed on the driver's id, not the user OBJECT: AuthContext builds its provider value
  // inline, so useAuth() hands back a fresh reference on every render. Depending on the
  // object would make `load` a new function each render and re-fire the fetch effect in a
  // loop; a primitive id only changes when the signed-in driver actually changes.
  const driverId = user?.id !== undefined ? String(user.id) : null

  const demoTrips = useMemo(
    () => (IS_DEMO_MODE && driverId !== null ? demoTripsFor(driverId) : NO_TRIPS),
    [driverId],
  )

  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  const reload = useCallback(() => {
    if (IS_DEMO_MODE || driverId === null) return
    void load(driverId, { force: true })
  }, [driverId])

  useEffect(() => {
    if (IS_DEMO_MODE) return
    if (driverId === null) { bindDriver(null); return }
    void load(driverId, { force: false })
  }, [driverId])

  if (IS_DEMO_MODE) return { trips: demoTrips, isLoading: false, loadError: null, reload }
  // A driver whose store is still bound to nobody (first render before the effect) reads
  // as loading, never as "no trips".
  const bound = snapshot.driverId === driverId
  return {
    trips: bound ? snapshot.trips : NO_TRIPS,
    isLoading: driverId !== null && (!bound || snapshot.isLoading || (snapshot.fetchedAt === null && snapshot.loadError === null)),
    loadError: bound ? snapshot.loadError : null,
    reload,
  }
}
