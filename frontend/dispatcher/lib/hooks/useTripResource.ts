'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { api, ApiError } from '@/lib/api/client'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import type { RealtimeKind } from '@/lib/realtime/types'
import { registerSessionCache } from '@/lib/cache/sessionCache'

const REQUEST_TIMEOUT_MS = 25_000
const LIVE_REFRESH_DELAY_MS = 200
const MAX_IDLE_ENTRIES = 30

const WITHDRAWN_STATUSES: readonly number[] = [401, 403, 404]

export interface TripResourceState<T> {
  data: T
  isLoading: boolean
  isValidating: boolean
  error: string | null
  errorStatus: number | null
  lastUpdated: number | null
  refetch: () => void
  refetchSilent: () => void
}

type Snapshot<T> = Omit<TripResourceState<T>, 'refetch' | 'refetchSilent'>

interface Entry<T> {
  snapshot: Snapshot<T>
  initial: T
  listeners: Set<() => void>
  inflight: Promise<void> | null
  issued: number
  applied: number
  debounce: ReturnType<typeof setTimeout> | null
}

const cache = new Map<string, Entry<unknown>>()

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
  publish(entry, { isValidating: true, isLoading: entry.snapshot.lastUpdated === null })

  let timer: ReturnType<typeof setTimeout> | null = null
  let settled = false
  const request = new Promise<void>(resolve => {
    const settle = (patch: Partial<Snapshot<T>>): void => {
      if (settled) return resolve()
      settled = true
      if (timer !== null) { clearTimeout(timer); timer = null }
      if (sequence < entry.applied) return resolve()
      entry.applied = sequence
      publish(entry, { ...patch, isValidating: false })
      resolve()
    }
    timer = setTimeout(
      () => settle({ isLoading: false, error: 'Request timed out. Please try again.', errorStatus: 0 }),
      REQUEST_TIMEOUT_MS,
    )
    void Promise.resolve().then(() => api.get<T>(key)).then(
      result => settle({ data: result, isLoading: false, error: null, errorStatus: null, lastUpdated: Date.now() }),
      (err: unknown) => {
        const status = err instanceof ApiError ? err.status : null
        const withdrawn = status !== null && WITHDRAWN_STATUSES.includes(status)
        settle({
          isLoading: false,
          error: err instanceof Error ? err.message : 'An unexpected error occurred',
          errorStatus: status,
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

/**
 * Trip-only loading policy: keep evidence visible and never apply obsolete responses.
 * `kinds` limits which live events refresh this resource (all kinds when omitted); a
 * reconnect refetches regardless, because it is the only recovery for a missed event.
 */
export function useTripResource<T>(
  tripId: string,
  suffix: string,
  initial: T,
  kinds?: readonly RealtimeKind[],
): TripResourceState<T> {
  const key = `/api/v1/trips/${tripId}${suffix}`
  const cacheGeneration = useSyncExternalStore(subscribeGeneration, getGeneration, getGeneration)
  const entry = getEntry<T>(key, initial)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const resolveEntry = useCallback(() => getEntry<T>(key, initial), [key, initial, cacheGeneration])

  const subscribe = useCallback((listener: () => void) => {
    const current = resolveEntry()
    current.listeners.add(listener)
    return () => {
      current.listeners.delete(listener)
      if (current.listeners.size === 0 && current.debounce !== null) {
        clearTimeout(current.debounce)
        current.debounce = null
      }
    }
  }, [resolveEntry])
  const getSnapshot = useCallback(() => resolveEntry().snapshot, [resolveEntry])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => { void load(key, resolveEntry(), false) }, [key, resolveEntry])

  const refetch = useCallback(() => { void load(key, resolveEntry(), true) }, [key, resolveEntry])

  const scheduleRefresh = useCallback((): void => {
    const current = resolveEntry()
    if (current.debounce !== null) return
    current.debounce = setTimeout(() => {
      current.debounce = null
      void load(key, current, true)
    }, LIVE_REFRESH_DELAY_MS)
  }, [key, resolveEntry])
  useLiveResource('trip', tripId, scheduleRefresh, { kinds })

  return { ...state, refetch, refetchSilent: refetch }
}
