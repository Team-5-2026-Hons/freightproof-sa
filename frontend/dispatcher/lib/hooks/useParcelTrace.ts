'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/lib/api/client'
import type { ParcelLookupResponse, ParcelTraceResponse } from '@shared/lib/types/parcel-trace'

const LOOKUP_PATH = '/api/v1/parcels/lookup'
const TRACE_PATH = '/api/v1/parcels/trace'

type Busy = 'lookup' | 'trace' | 'more-matches' | 'more-journeys' | null

export interface ParcelTraceState {
  lookup: ParcelLookupResponse | null
  trace: ParcelTraceResponse | null
  busy: Busy
  error: string | null
  clear: () => void
  search: (barcode: string, waybill?: string) => Promise<void>
  moreMatches: () => Promise<void>
  moreJourneys: () => Promise<void>
}

function tracePath(barcode: string, waybill: string, cursor?: string): string {
  const params = new URLSearchParams({ barcode, waybill_reference: waybill })
  if (cursor) params.set('cursor', cursor)
  return `${TRACE_PATH}?${params}`
}

export function useParcelTrace(): ParcelTraceState {
  const [lookup, setLookup] = useState<ParcelLookupResponse | null>(null)
  const [trace, setTrace] = useState<ParcelTraceResponse | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; generation.current += 1 }
  }, [])

  const current = useCallback((id: number): boolean => mounted.current && generation.current === id, [])
  const clear = useCallback((): void => {
    generation.current += 1
    setLookup(null); setTrace(null); setError(null); setBusy(null)
  }, [])

  const failure = useCallback((err: unknown): void => {
    if (err instanceof ApiError && [401, 403, 404].includes(err.status)) {
      // Withdrawal outranks continuity: a revoked account must not retain old evidence.
      setTrace(null); setLookup(null)
      setError('This parcel evidence is unavailable to your account. Sign in again or search for another barcode.')
    } else {
      setError('Could not load parcel evidence. Check your connection and try again.')
    }
  }, [])

  const search = useCallback(async (barcode: string, waybill?: string): Promise<void> => {
    const id = ++generation.current
    setLookup(null); setTrace(null); setError(null); setBusy('lookup')
    try {
      const matches = await api.get<ParcelLookupResponse>(`${LOOKUP_PATH}?${new URLSearchParams({ barcode: barcode.trim() })}`)
      if (!current(id)) return
      setLookup(matches)
      const selected = waybill ?? (matches.items.length === 1 && !matches.next_after ? matches.items[0].waybill_reference : null)
      if (selected) {
        setBusy('trace')
        const result = await api.get<ParcelTraceResponse>(tracePath(matches.barcode, selected))
        if (current(id)) setTrace(result)
      }
    } catch (err: unknown) {
      if (current(id)) failure(err)
    } finally {
      if (current(id)) setBusy(null)
    }
  }, [current, failure])

  async function moreMatches(): Promise<void> {
    if (!lookup?.next_after || busy) return
    const id = ++generation.current
    setBusy('more-matches'); setError(null)
    try {
      const params = new URLSearchParams({ barcode: lookup.barcode, after: lookup.next_after })
      const result = await api.get<ParcelLookupResponse>(`${LOOKUP_PATH}?${params}`)
      if (current(id)) setLookup({ ...result, items: [...lookup.items, ...result.items] })
    } catch (err: unknown) {
      if (current(id)) failure(err)
    } finally {
      if (current(id)) setBusy(null)
    }
  }

  async function moreJourneys(): Promise<void> {
    if (!trace?.next_cursor || busy) return
    const id = ++generation.current
    setBusy('more-journeys'); setError(null)
    try {
      const result = await api.get<ParcelTraceResponse>(tracePath(trace.barcode, trace.waybill_reference, trace.next_cursor))
      if (current(id)) {
        const seen = new Set(trace.journeys.map(j => j.trip_id))
        setTrace({ ...result, journeys: [...trace.journeys, ...result.journeys.filter(j => !seen.has(j.trip_id))] })
      }
    } catch (err: unknown) {
      if (current(id)) failure(err)
    } finally {
      if (current(id)) setBusy(null)
    }
  }

  return { lookup, trace, busy, error, clear, search, moreMatches, moreJourneys }
}
