'use client'

import { useEffect, useRef } from 'react'
import { useRealtimeChannel } from './RealtimeProvider'
import type { RealtimeEvent, RealtimeKind } from './types'

export interface LiveResourceOptions {
  kinds?: readonly RealtimeKind[]
}

export function useLiveResource(
  resource: RealtimeEvent['resource'],
  id: string | 'any',
  onChange: () => void,
  options: LiveResourceOptions = {},
): void {
  const { subscribe, reconnectNonce } = useRealtimeChannel()

  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

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

  const isFirst = useRef(true)
  useEffect(() => {
    if (isFirst.current) {
      isFirst.current = false
      return
    }
    onChangeRef.current()
  }, [reconnectNonce])
}
