'use client'

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import { BASE_URL } from '@/lib/api/client'
import { getAccessToken } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/useAuth'
import { useToast } from '@/lib/hooks/useToast'
import { FRAME_SEPARATOR, STREAM_PATH, backoffMs, parseFrame } from './sse'
import type { RealtimeEvent, RealtimeStatus } from './types'

// One SSE connection per authenticated dispatcher. The backend pushes thin "trip
// changed" pings on the dispatcher's org channel; this provider fans them out to
// subscribers (useLiveResource), which react by refetching the affected data. The
// dispatcher only ever receives here — it never sends — which is why SSE fits.

type Listener = (event: RealtimeEvent) => void

interface RealtimeContextValue {
  status: RealtimeStatus
  // Register a listener; returns an unsubscribe fn. Stable across renders.
  subscribe: (listener: Listener) => () => void
  // Increments on every successful (re)connection. Consumers use a *change* after the
  // first as the cue to refetch — a reconnect may have missed pings while down (D7).
  reconnectNonce: number
}

// Default is a no-op so a component that renders outside the provider (e.g. in a unit
// test) degrades to "no live updates" instead of throwing.
const RealtimeContext = createContext<RealtimeContextValue>({
  status: 'connecting',
  subscribe: () => () => {},
  reconnectNonce: 0,
})

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const { notify } = useToast()
  const enabled = !!user

  const [status, setStatus] = useState<RealtimeStatus>('connecting')
  const [reconnectNonce, setReconnectNonce] = useState(0)

  const listenersRef = useRef<Set<Listener>>(new Set())

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener)
    return () => {
      listenersRef.current.delete(listener)
    }
  }, [])

  const handleEvent = useCallback((event: RealtimeEvent) => {
    // Fan out to every subscribed screen so the right data refetches in place.
    listenersRef.current.forEach(listener => listener(event))
    // Global reaction: a driver-raised exception is the one signal a dispatcher must
    // notice even when not looking at that trip, so it pops a sticky alert. The subject's
    // detail (GPS, description) never crosses the channel — the dispatcher opens the trip,
    // whose page has already refetched, to review it.
    if (event.kind === 'exception_raised') {
      notify({
        kind: 'error',
        title: 'Exception raised',
        body: 'A driver flagged an exception — open the trip to review.',
      })
    }
  }, [notify])

  useEffect(() => {
    // Only a signed-in dispatcher gets a connection. In practice this layout unmounts on
    // sign-out, so `enabled` is true whenever mounted; the guard is defensive.
    if (!enabled) return

    let cancelled = false
    let controller: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const clearRetry = () => {
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const scheduleReconnect = () => {
      if (cancelled || document.hidden) return
      clearRetry()
      attempt += 1
      setStatus('reconnecting')
      retryTimer = setTimeout(openConnection, backoffMs(attempt))
    }

    const pump = async (body: ReadableStream<Uint8Array>) => {
      const reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let sep = buffer.indexOf(FRAME_SEPARATOR)
        while (sep !== -1) {
          const frame = buffer.slice(0, sep)
          buffer = buffer.slice(sep + FRAME_SEPARATOR.length)
          const event = parseFrame(frame)
          if (event) handleEvent(event)
          sep = buffer.indexOf(FRAME_SEPARATOR)
        }
      }
    }

    const openConnection = async () => {
      if (cancelled || document.hidden) return
      clearRetry()
      controller = new AbortController()
      // Keep the "Live" badge steady across silent heartbeats; only drop to connecting
      // when we're genuinely not live.
      setStatus(prev => (prev === 'live' ? prev : 'connecting'))
      try {
        const token = getAccessToken()
        const res = await fetch(`${BASE_URL}${STREAM_PATH}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!res.ok || !res.body) throw new Error(`stream responded ${res.status}`)

        attempt = 0
        setStatus('live')
        // Bump on every open; consumers ignore the first and refetch on later ones.
        setReconnectNonce(n => n + 1)

        await pump(res.body) // resolves when the server closes the stream
        if (!cancelled) scheduleReconnect()
      } catch {
        // Aborted (unmount/visibility) or a network/HTTP failure. Reconnect unless we're
        // intentionally stopped or the tab is backgrounded (resumes on visibility).
        if (!cancelled && !document.hidden) scheduleReconnect()
      }
    }

    // Pause while the tab is hidden (drop the socket, stop retrying); resume on return.
    const onVisibility = () => {
      if (document.hidden) {
        controller?.abort()
        clearRetry()
        setStatus('reconnecting')
      } else {
        attempt = 0
        void openConnection()
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    void openConnection()

    return () => {
      cancelled = true
      controller?.abort()
      clearRetry()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, handleEvent])

  const value = useMemo<RealtimeContextValue>(
    () => ({ status, subscribe, reconnectNonce }),
    [status, subscribe, reconnectNonce],
  )

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>
}

// Internal — consumed by useLiveResource. Exposes the raw channel.
export function useRealtimeChannel(): RealtimeContextValue {
  return useContext(RealtimeContext)
}

// The connection status, for the Live badge.
export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeContext).status
}
