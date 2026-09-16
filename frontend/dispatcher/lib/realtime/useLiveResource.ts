'use client'

import { useEffect, useRef } from 'react'
import { useRealtimeChannel } from './RealtimeProvider'
import type { RealtimeEvent, RealtimeKind } from './types'

export interface LiveResourceOptions {
  kinds?: readonly RealtimeKind[]
}

// Subscribe a screen to live changes for a resource. `onChange` fires on a matching
// event, and again after any reconnection (to catch events missed while down). Typically
// a silent refetch.
//
//   useLiveResource('trip', tripId, refetchSilent)   // this trip only
//   useLiveResource('trip', 'any', refetchSilent)    // any trip (e.g. the list)
export function useLiveResource(
  resource: RealtimeEvent['resource'],
  id: string | 'any',
  onChange: () => void,
  options: LiveResourceOptions = {},
): void {
  const { subscribe, reconnectNonce } = useRealtimeChannel()

  // Keep the latest callback without re-subscribing on every render.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Keep the latest selection without reconnecting the listener when a caller passes
  // an inline array from render.
  const kindsRef = useRef(options.kinds)
  useEffect(() => {
    kindsRef.current = options.kinds
  }, [options.kinds])

  useEffect(() => {
    return subscribe(event => {
      if (event.resource !== resource) return
      if (id !== 'any' && event.id !== id) return
      if (kindsRef.current && !kindsRef.current.includes(event.kind)) return
      onChangeRef.current()
    })
  }, [subscribe, resource, id])

  // A reconnection may have missed events; refetch to reconcile. Skip the first observed
  // value — that's the initial connect, and the consumer already fetched on mount.
  const isFirst = useRef(true)
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    onChangeRef.current()
  }, [reconnectNonce])
}
