"use client"

import { useCallback } from 'react'

import { api } from '@/lib/api/client'
import { useLiveResource } from '@/lib/realtime/useLiveResource'
import type {
  ExceptionResolutionMethod,
  TripException,
} from '@shared/lib/types/exception'
import { useAsyncData } from './useAsyncData'

const EMPTY: TripException[] = []

export interface UseExceptions {
  exceptions: TripException[]
  isLoading: boolean
  // MUST be surfaced. An exception queue that fails to load renders identically to one
  // that is genuinely empty — and "no exceptions" is the single most reassuring thing
  // this screen can say. Showing it because a fetch failed is the worst error this page
  // can make.
  error: string | null
  refetch: () => void
  refetchSilent: () => void
}

/**
 * Every exception in the caller's organisation, newest first.
 *
 * Takes no arguments, deliberately. The endpoint supports `?resolved=` and the server
 * scopes to the caller's organisation (that scoping is authorisation and cannot happen
 * here), but no screen passes a filter: the list page fetches once and splits the tabs
 * client-side, and the detail page opens an exception by id without knowing its state.
 *
 * The hook previously accepted `resolved` and `tripId`. `resolved` was also SILENTLY
 * BROKEN — useAsyncData holds its fetch function in a ref whose effect depends only on
 * `timeoutMs`, so changing the filter on a mounted hook re-rendered without ever
 * refetching. Rather than reach into a hook every screen shares to fix a path nothing
 * used, both filters are gone; add one back with a test that rerenders, not one that
 * mounts fresh per case.
 */
export function useExceptions(): UseExceptions {
  // Stable identity: useAsyncData refetches when this changes, and a new closure per
  // render would refetch on every render.
  const fetchExceptions = useCallback(
    () => api.get<TripException[]>('/api/v1/exceptions'),
    [],
  )

  const { data, isLoading, error, refetch, refetchSilent } = useAsyncData<TripException[]>(
    fetchExceptions,
    EMPTY,
  )

  // Any trip, not one: this backs a queue spanning every trip in the organisation, so a
  // seal mismatch on a trip nobody is looking at still has to appear. Silent — the list
  // updates in place rather than flashing a spinner under someone reading it.
  useLiveResource('trip', 'any', refetchSilent)

  return { exceptions: data, isLoading, error, refetch, refetchSilent }
}

/** Record how an exception was resolved. The server sets the resolver and the timestamp. */
export function resolveException(
  exceptionId: string,
  body: { resolver_note: string; resolution_method: ExceptionResolutionMethod },
): Promise<TripException> {
  return api.patch<TripException>(`/api/v1/exceptions/${exceptionId}/resolve`, body)
}
