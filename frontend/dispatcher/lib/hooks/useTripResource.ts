'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { api, ApiError } from '@/lib/api/client'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import { registerSessionCache } from '@/lib/cache/sessionCache'

const REQUEST_TIMEOUT_MS = 25_000
const LIVE_REFRESH_DELAY_MS = 200
// Entries with no mounted reader are evicted oldest-first past this many keys, so moving
// through a long trip list cannot grow the cache without bound.
const MAX_IDLE_ENTRIES = 30

// A refusal is not a failure to fetch, and the two must not be handled alike.
//
// Holding the last successful copy behind an error is right for a timeout or a 500: the
// record is still this dispatcher's and still true, and blanking an evidence page over a
// flaky network would be the worse outcome. It is wrong for these three. 401 and 403 mean
// the server has said this record may not be shown to whoever is asking, and 404 is how
// this backend answers for a trip belonging to another organisation — deliberately, so
// the response does not leak that it exists. Answering any of them by leaving the record
// on screen is the client overruling the server on access.
const WITHDRAWN_STATUSES: readonly number[] = [401, 403, 404]

export interface TripResourceState<T> {
  data: T
  /** No data yet and a request is running — the only state that may blank the view. */
  isLoading: boolean
  /** A request is in flight, cached data or not. Drives refresh affordances, which would
   *  otherwise look inert on a revalidation that has something to show behind it. */
  isValidating: boolean
  error: string | null
  /** HTTP status; 0 means a network/timeout failure, null means no known status. */
  errorStatus: number | null
  /** Time of the last successful response; retained on refresh failure. */
  lastUpdated: number | null
  refetch: () => void
  refetchSilent: () => void
}

type Snapshot<T> = Omit<TripResourceState<T>, 'refetch' | 'refetchSilent'>

interface Entry<T> {
  /** Replaced wholesale on every change: useSyncExternalStore compares by identity. */
  snapshot: Snapshot<T>
  /** The empty value for this key, kept so a withdrawn record can be reset to pristine
   *  rather than merely blanked — `load` has no other way to reach it. */
  initial: T
  listeners: Set<() => void>
  inflight: Promise<void> | null
  /** Last issued request number, and the newest one already applied. */
  issued: number
  applied: number
  debounce: ReturnType<typeof setTimeout> | null
}

// Module-level so every hook reading the same URL shares one record and one request.
const cache = new Map<string, Entry<unknown>>()

// Bumped every time the cache is emptied. A mounted hook holds a direct reference to the
// entry it subscribed to, so dropping the Map alone would leave it bound to a record
// nothing will ever publish to again — blank, and with no reason to refetch. Reading the
// generation as a store makes every mounted hook re-subscribe and re-fetch instead.
let generation = 0
const generationListeners = new Set<() => void>()

function subscribeGeneration(listener: () => void): () => void {
  generationListeners.add(listener)
  return () => { generationListeners.delete(listener) }
}

function getGeneration(): number {
  return generation
}

/**
 * Forget every cached record.
 *
 * In-flight requests are left to finish into the entries they were issued against: those
 * entries are no longer in the Map and no longer subscribed to, so their responses land
 * on an object nothing can read and are collected. That is deliberately cheaper than
 * threading an abort signal through, and has the same effect — no response issued under
 * the old identity can reach the screen.
 */
export function clearTripResourceCache(): void {
  cache.forEach(entry => { if (entry.debounce !== null) clearTimeout(entry.debounce) })
  cache.clear()
  generation += 1
  generationListeners.forEach(listener => listener())
}

registerSessionCache(clearTripResourceCache)

/** Test-only alias. The cache outlives any component, so a suite must clear it between
 *  cases or one test's record answers the next one's first render. */
export const __resetTripResourceCache = clearTripResourceCache

function getEntry<T>(key: string, initial: T): Entry<T> {
  const existing = cache.get(key) as Entry<T> | undefined
  if (existing) return existing
  const entry: Entry<T> = {
    snapshot: { data: initial, isLoading: true, isValidating: false, error: null, errorStatus: null, lastUpdated: null },
    initial,
    listeners: new Set(), inflight: null, issued: 0, applied: 0, debounce: null,
  }
  cache.set(key, entry as Entry<unknown>)
  evictIdle()
  return entry
}

function evictIdle(): void {
  if (cache.size <= MAX_IDLE_ENTRIES) return
  for (const [key, entry] of cache) {
    if (cache.size <= MAX_IDLE_ENTRIES) break
    // Never evict what something is currently rendering, or a request would be orphaned.
    if (entry.listeners.size === 0 && entry.inflight === null) cache.delete(key)
  }
}

function publish<T>(entry: Entry<T>, patch: Partial<Snapshot<T>>): void {
  entry.snapshot = { ...entry.snapshot, ...patch }
  entry.listeners.forEach(listener => listener())
}

/**
 * Fetch `key` into its cache entry.
 *
 * `force` is what keeps live updates live. A background revalidation may join a request
 * already in flight, but an SSE-driven refresh must not: that request may have been
 * issued BEFORE the event, so joining it would apply pre-event data and stamp it as
 * fresh. Forced calls always issue their own request.
 */
function load<T>(key: string, entry: Entry<T>, force: boolean): Promise<void> {
  if (entry.inflight && !force) return entry.inflight

  const sequence = ++entry.issued
  // Only a first load blanks the view. Once there is data, revalidation happens behind it.
  publish(entry, { isValidating: true, isLoading: entry.snapshot.lastUpdated === null })

  let timer: ReturnType<typeof setTimeout> | null = null
  // Guards the timeout-then-late-response race: once a request has settled — including by
  // timing out — its own response must never be applied, or a request the reader was
  // already told had failed silently repopulates the record afterwards.
  let settled = false
  const request = new Promise<void>(resolve => {
    const settle = (patch: Partial<Snapshot<T>>): void => {
      if (settled) return resolve()
      settled = true
      if (timer !== null) { clearTimeout(timer); timer = null }
      // A slower older response must never overwrite a newer one that already landed.
      if (sequence < entry.applied) return resolve()
      entry.applied = sequence
      publish(entry, { ...patch, isValidating: false })
      resolve()
    }
    timer = setTimeout(
      () => settle({ isLoading: false, error: 'Request timed out. Please try again.', errorStatus: 0 }),
      REQUEST_TIMEOUT_MS,
    )
    // Promise wrapping also handles a synchronous client failure without leaving a spinner.
    void Promise.resolve().then(() => api.get<T>(key)).then(
      result => settle({ data: result, isLoading: false, error: null, errorStatus: null, lastUpdated: Date.now() }),
      (err: unknown) => {
        const status = err instanceof ApiError ? err.status : null
        const withdrawn = status !== null && WITHDRAWN_STATUSES.includes(status)
        settle({
          isLoading: false,
          error: err instanceof Error ? err.message : 'An unexpected error occurred',
          errorStatus: status,
          // Back to pristine, not merely blank: lastUpdated is what tells the next mount
          // whether it has anything to show behind a revalidation, so leaving it set
          // would suppress the loading state over a record that is no longer there.
          ...(withdrawn ? { data: entry.initial, lastUpdated: null } : {}),
        })
      },
    )
  }).finally(() => {
    if (entry.inflight === request) entry.inflight = null
  })

  entry.inflight = request
  return request
}

/** Trip-only loading policy: keep evidence visible and never apply obsolete responses. */
export function useTripResource<T>(tripId: string, suffix: string, initial: T): TripResourceState<T> {
  const key = `/api/v1/trips/${tripId}${suffix}`
  // Every callback below closes over an entry, so all of them have to be rebuilt when the
  // cache is emptied — hence the generation in each dependency list, not just one.
  const cacheGeneration = useSyncExternalStore(subscribeGeneration, getGeneration, getGeneration)
  const entry = getEntry<T>(key, initial)

  // One accessor that every callback below depends on, so emptying the cache re-points
  // all of them at the fresh entry in a single step. cacheGeneration is not read inside:
  // it is an invalidation key, which is precisely what exhaustive-deps cannot see.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolveEntry = useCallback(() => getEntry<T>(key, initial), [key, initial, cacheGeneration])

  const subscribe = useCallback((listener: () => void) => {
    const current = resolveEntry()
    current.listeners.add(listener)
    return () => {
      current.listeners.delete(listener)
      // Nothing is reading this key any more, so a burst that arrived just before unmount
      // must not still spend a request on a screen that has gone.
      if (current.listeners.size === 0 && current.debounce !== null) {
        clearTimeout(current.debounce)
        current.debounce = null
      }
    }
  }, [resolveEntry])
  const getSnapshot = useCallback(() => resolveEntry().snapshot, [resolveEntry])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Revalidate on every mount even when the cache already answered, so what is on screen
  // is never only a memory of the record — evidence has to be re-read, not remembered.
  useEffect(() => { void load(key, resolveEntry(), false) }, [key, resolveEntry])

  const refetch = useCallback(() => { void load(key, resolveEntry(), true) }, [key, resolveEntry])

  const scheduleRefresh = useCallback((): void => {
    const current = resolveEntry()
    // One refresh per short event burst; reconnects follow this same recovery path.
    if (current.debounce !== null) return
    current.debounce = setTimeout(() => {
      current.debounce = null
      void load(key, current, true)
    }, LIVE_REFRESH_DELAY_MS)
  }, [key, resolveEntry])
  useLiveResource('trip', tripId, scheduleRefresh)

  return { ...state, refetch, refetchSilent: refetch }
}
