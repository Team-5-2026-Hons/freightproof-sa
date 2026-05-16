'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncState<T> {
  data: T
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function useAsyncData<T>(fetchFn: () => Promise<T>, initial: T): AsyncState<T> {
  const [data, setData] = useState<T>(initial)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchRef = useRef(fetchFn)

  // Keep ref in sync without re-triggering the fetch effect
  useEffect(() => {
    fetchRef.current = fetchFn
  }, [fetchFn])

  const refetch = useCallback(() => {
    setIsLoading(true)
    setError(null)
    fetchRef.current()
      .then((result) => {
        setData(result)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setIsLoading(false)
      })
  }, [])

  // Runs once on mount; uses ref so callers don't need to memoize fetchFn
  useEffect(() => {
    setIsLoading(true)
    setError(null)
    fetchRef.current()
      .then((result) => {
        setData(result)
        setIsLoading(false)
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'An unexpected error occurred')
        setIsLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { data, isLoading, error, refetch }
}
