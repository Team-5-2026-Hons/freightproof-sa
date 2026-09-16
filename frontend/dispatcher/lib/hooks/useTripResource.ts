'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { api, ApiError } from '@/lib/api/client'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import { registerSessionCache } from '@/lib/cache/sessionCache'

const REQUEST_TIMEOUT_MS = 25_000
const LIVE_REFRESH_DELAY_MS = 200
// Entries with no mounted reader are evicted oldest-first past this many keys, so a long
// trip list can't grow the cache unbounded.
const MAX_IDLE_ENTRIES = 30

// A refusal (401/403/404 — the backend uses 404 to avoid leaking another org's trip)
// must blank the record, unlike a timeout/500 where holding the last good copy is right.
const WITHDRAWN_STATUSES: readonly number[] = [401, 403, 404]

export interface TripResourceState<T> {
  data: T
  /** No data yet and a request is running — the only state that may blank the view. */
  isLoading: boolean
  /** A request is in flight, cached data or not — drives refresh affordances during a
   *  revalidation that already has something to show. */
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
  /** The empty value for this key, so a withdrawn record can reset to pristine. */
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

// Bumped every time the cache is emptied. A mounted hook holds a direct reference to its
// entry, so dropping the Map alone would leave it bound to a record nothing will ever
// publish to again. Reading generation as a store forces every hook to re-subscribe.
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
 * Forget every cached record. In-flight requests finish into their now-orphaned entries
 * (no longer in the Map or subscribed to) rather than being aborted — cheaper, same effect.
 */
export function clearTripResourceCache(): void {
  cache.forEach(entry => { if (entry.debounce !== null) clearTimeout(entry.debounce) })
  cache.clear()
  generation += 1
  generationListeners.forEach(listener => listener())
}

registerSessionCache(clearTripResourceCache)

/** Test-only alias — the cache outlives any component, so a suite must clear it between cases. */
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
 * Fetch `key` into its cache entry. `force` keeps live updates live: an SSE-driven
 * refresh must issue its own request rather than joining one in flight, since that
 * request may predate the event and would apply stale data stamped as fresh.
 */
function load<T>(key: string, entry: Entry<T>, force: boolean): Promise<void> {
  if (entry.inflight && !force) return entry.inflight

  const sequence = ++entry.issued
  // Only a first load blanks the view. Once there is data, revalidation happens behind it.
  publish(entry, { isValidating: true, isLoading: entry.snapshot.lastUpdated === null })

  let timer: ReturnType<typeof setTimeout> | null = null
  // Guards the timeout-then-late-response race: once settled, a request's own response
  // must never be applied again.
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
          // Back to pristine, not merely blank: lastUpdated tells the next mount whether
          // it has anything to show, and must not stay set for a record that's gone.
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
  // Every callback below closes over an entry, so all need rebuilding when the cache empties.
  const cacheGeneration = useSyncExternalStore(subscribeGeneration, getGeneration, getGeneration)
  const entry = getEntry<T>(key, initial)

  // cacheGeneration is an invalidation key, not read inside — exhaustive-deps can't see that.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolveEntry = useCallback(() => getEntry<T>(key, initial), [key, initial, cacheGeneration])

  const subscribe = useCallback((listener: () => void) => {
    const current = resolveEntry()
    current.listeners.add(listener)
    return () => {
      current.listeners.delete(listener)
      // A burst that arrived just before unmount must not spend a request on a gone screen.
      if (current.listeners.size === 0 && current.debounce !== null) {
        clearTimeout(current.debounce)
        current.debounce = null
      }
    }
  }, [resolveEntry])
  const getSnapshot = useCallback(() => resolveEntry().snapshot, [resolveEntry])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  // Revalidate on every mount even when the cache already answered: evidence must be
  // re-read, not remembered.
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
