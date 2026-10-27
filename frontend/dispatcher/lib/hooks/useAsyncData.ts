'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T
  isLoading: boolean
  error: string | null
  refetch: () => void
  refetchSilent: () => void
}

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

  useEffect(() => {
    fetchRef.current = fetchFn
  }, [fetchFn])

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const inFlightRef = useRef(false)
  const followUpRef = useRef<{ showLoadingSpinner: boolean } | null>(null)

  const execute = useCallback(function start(showLoadingSpinner: boolean): void {
    if (inFlightRef.current) {
      const spinner = showLoadingSpinner || (followUpRef.current?.showLoadingSpinner ?? false)
      followUpRef.current = { showLoadingSpinner: spinner }
      return
    }
    inFlightRef.current = true
    if (showLoadingSpinner) setIsLoading(true)
    setError(null)

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

  useEffect(() => {
    run()
  }, [run])

  return { data, isLoading, error, refetch: run, refetchSilent: runSilent }
}
