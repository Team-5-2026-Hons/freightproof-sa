'use client'

import { useCallback, useState } from 'react'

import { api, ApiError } from '@/lib/api/client'
import type {
  DevTripSummary,
  ExceptionTriggerRequest,
  ExceptionTriggerResponse,
  FlushMockStateResponse,
  PpTriggerRequest,
  PpTriggerResponse,
  ScanTriggerRequest,
  ScanTriggerResponse,
} from '@/lib/types/dev'

const DEV_BASE = '/api/v1/dev'

export interface UseDevTriggersResult {
  trips: DevTripSummary[]
  isLoading: boolean
  error: string | null
  lastResult: string | null
  loadTrips: () => Promise<void>
  triggerScan: (body: ScanTriggerRequest) => Promise<ScanTriggerResponse | null>
  triggerPpChange: (body: PpTriggerRequest) => Promise<PpTriggerResponse | null>
  triggerException: (body: ExceptionTriggerRequest) => Promise<ExceptionTriggerResponse | null>
  flushMockState: () => Promise<FlushMockStateResponse | null>
}

/**
 * Calls the dev trigger endpoints. Every failure is surfaced as readable text
 * rather than swallowed — an unexplained no-op mid-demo is the worst outcome,
 * and a 404 here usually means DEV_PANEL_ENABLED is not set on the backend.
 */
export function useDevTriggers(): UseDevTriggersResult {
  const [trips, setTrips] = useState<DevTripSummary[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<string | null>(null)

  const describeError = (err: unknown): string => {
    if (err instanceof ApiError) {
      return err.status === 404
        ? `${err.message} (is DEV_PANEL_ENABLED set on the backend?)`
        : err.message
    }
    return err instanceof Error ? err.message : String(err)
  }

  const run = useCallback(async <T,>(
    action: () => Promise<T>,
    describe: (result: T) => string,
  ): Promise<T | null> => {
    setIsLoading(true)
    setError(null)
    try {
      const result = await action()
      setLastResult(describe(result))
      return result
    } catch (err: unknown) {
      setError(describeError(err))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  const loadTrips = useCallback(async (): Promise<void> => {
    await run(
      () => api.get<DevTripSummary[]>(`${DEV_BASE}/trips`),
      (result) => {
        setTrips(result)
        return `Loaded ${result.length} trip(s).`
      },
    )
  }, [run])

  const triggerScan = useCallback(
    (body: ScanTriggerRequest) =>
      run(
        () => api.post<ScanTriggerResponse>(`${DEV_BASE}/scans`, body),
        (result) => {
          const missing = result.consignments.reduce((n, c) => n + c.missing_barcodes.length, 0)
          const unexpected = result.consignments.reduce((n, c) => n + c.unexpected_barcodes.length, 0)
          const scanned = result.consignments.reduce((n, c) => n + c.observed_count, 0)
          return `Scanned ${scanned}. Missing ${missing}. Unexpected ${unexpected}.`
        },
      ),
    [run],
  )

  const triggerPpChange = useCallback(
    (body: PpTriggerRequest) =>
      run(
        () => api.post<PpTriggerResponse>(`${DEV_BASE}/pp/waybill`, body),
        (result) =>
          `${result.parcel_perfect_reference}: expected ${result.parcel_count_expected}, ` +
          `manifest ${result.pp_manifest_number ?? 'none'}.`,
      ),
    [run],
  )

  const triggerException = useCallback(
    (body: ExceptionTriggerRequest) =>
      run(
        () => api.post<ExceptionTriggerResponse>(`${DEV_BASE}/exceptions`, body),
        (result) => `Raised ${result.exception_type} (${result.severity}).`,
      ),
    [run],
  )

  const flushMockState = useCallback(
    () =>
      run(
        () => api.post<FlushMockStateResponse>(`${DEV_BASE}/mock-state/flush`, {}),
        (result) => `Cleared ${result.keys_deleted} staged key(s). Evidence untouched.`,
      ),
    [run],
  )

  return {
    trips, isLoading, error, lastResult,
    loadTrips, triggerScan, triggerPpChange, triggerException, flushMockState,
  }
}
