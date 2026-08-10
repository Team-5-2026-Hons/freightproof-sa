'use client'

import { useEffect, useRef } from 'react'
import { useRealtimeChannel } from './RealtimeProvider'
import type { RealtimeEvent } from './types'

// Subscribe a screen to live changes for a resource. `onChange` fires when a matching
// event arrives, and again after any reconnection (to catch pings missed while the
// connection was down — D7). The typical `onChange` is a silent refetch.
//
//   useLiveResource('trip', tripId, refetchSilent)   // this trip only
//   useLiveResource('trip', 'any', refetchSilent)    // any trip (e.g. the list)
export function useLiveResource(
  resource: RealtimeEvent['resource'],
  id: string | 'any',
  onChange: () => void,
): void {
  const { subscribe, reconnectNonce } = useRealtimeChannel()

  // Keep the latest callback without re-subscribing on every render.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    return subscribe(event => {
      if (event.resource !== resource) return
      if (id !== 'any' && event.id !== id) return
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
