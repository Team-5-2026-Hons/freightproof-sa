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

  const execute = useCallback((showLoadingSpinner: boolean) => {
    if (showLoadingSpinner) setIsLoading(true)
    setError(null)

    // `settled` ensures exactly one of {success, failure, timeout} updates state — whichever
    // happens first wins, and the losers become no-ops.
    let settled = false
    const timer = setTimeout(() => {
      if (settled || !mountedRef.current) return
      settled = true
      setError('Request timed out. Please try again.')
      setIsLoading(false)
    }, timeoutMs)

    fetchRef.current()
      .then((result) => {
        if (settled || !mountedRef.current) return
        settled = true
        clearTimeout(timer)
        setData(result)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        if (settled || !mountedRef.current) return
        settled = true
        clearTimeout(timer)
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setIsLoading(false)
      })
  }, [timeoutMs])

  const run = useCallback(() => execute(true), [execute])
  const runSilent = useCallback(() => execute(false), [execute])

  // Runs on mount and whenever `run` changes (stable while timeoutMs is unchanged).
  // run() kicks off async work; the synchronous setIsLoading/setError it triggers are
  // no-ops on mount (initial state already matches) and only re-fire on a deliberate
  // refetch, so they cannot cascade. The rule is a blanket heuristic; suppress it here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    run()
  }, [run])

  return { data, isLoading, error, refetch: run, refetchSilent: runSilent }
}
