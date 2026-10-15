'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T
  isLoading: boolean
  error: string | null
  refetch: () => void
  // Refetches without setting isLoading — use after mutations where the page
  // should stay visible and update in place (e.g. after a successful save).
  refetchSilent: () => void
}

// Backstop ceiling. The API client (lib/api/client.ts) already bounds its own
// session lookup + fetch, so a normal request settles well before this. This timeout
// only fires if a fetch passed to the hook never settles for any other reason — it
// guarantees the UI can never get permanently stuck on a loading spinner.
const DEFAULT_TIMEOUT_MS = 25_000

export function useAsyncData<T>(
  fetchFn: () => Promise<T>,
  initial: T,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): AsyncState<T> {
  const [data, setData] = useState<T>(initial)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRef = useRef(fetchFn)

  // Keep ref in sync without re-triggering the fetch effect
  useEffect(() => {
    fetchRef.current = fetchFn
  }, [fetchFn])

  // Guards against setState after unmount when a slow/timed-out fetch resolves late.
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Live pages refetch on every event. One request runs at a time, and calls that arrive meanwhile
  // collapse into a single follow-up that starts when it settles. Responses therefore arrive in
  // order and each is newer than what is on screen, so every one is applied; a burst of events costs
  // two requests, not one per event. (Invalidating the earlier request on every call instead would
  // discard every response for as long as events keep arriving faster than one request takes.)
  const inFlightRef = useRef(false)
  const followUpRef = useRef<{ showLoadingSpinner: boolean } | null>(null)

  const execute = useCallback(function start(showLoadingSpinner: boolean): void {
    if (inFlightRef.current) {
      // A spinner request outranks a silent one: the caller asked to show loading.
      const spinner = showLoadingSpinner || (followUpRef.current?.showLoadingSpinner ?? false)
      followUpRef.current = { showLoadingSpinner: spinner }
      return
    }
    inFlightRef.current = true
    if (showLoadingSpinner) setIsLoading(true)
    setError(null)

    // `settled` ensures exactly one of {success, failure, timeout} updates state — whichever
    // happens first wins, and the losers become no-ops (a response landing after its own
    // timeout is dropped).
    let settled = false
    const settle = (apply: () => void): void => {
      settled = true
      clearTimeout(timer)
      inFlightRef.current = false
      if (!mountedRef.current) return
      apply()
      const followUp = followUpRef.current
      followUpRef.current = null
      if (followUp) start(followUp.showLoadingSpinner)
    }

    const timer = setTimeout(() => {
      if (settled) return
      settle(() => {
        setError('Request timed out. Please try again.')
        setIsLoading(false)
      })
    }, timeoutMs)

    fetchRef.current()
      .then((result) => {
        if (settled) return
        settle(() => {
          setData(result)
          setIsLoading(false)
        })
      })
      .catch((err: unknown) => {
        if (settled) return
        settle(() => {
          setError(err instanceof Error ? err.message : 'An unexpected error occurred')
          setIsLoading(false)
        })
      })
  }, [timeoutMs])

  const run = useCallback(() => execute(true), [execute])
  const runSilent = useCallback(() => execute(false), [execute])

  // Runs on mount and whenever `run` changes (stable while timeoutMs is unchanged).
  // run() kicks off async work; the synchronous setIsLoading/setError it triggers are
  // no-ops on mount (initial state already matches) and only re-fire on a deliberate
  // refetch, so they cannot cascade.
  useEffect(() => {
    run()
  }, [run])

  return { data, isLoading, error, refetch: run, refetchSilent: runSilent }
}
