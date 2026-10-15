'use client'

import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react'
import { BASE_URL } from '@/lib/api/client'
import { getAccessToken } from '@/lib/supabase/client'
import { useAuth } from '@/lib/hooks/useAuth'
import { useToast } from '@/lib/hooks/useToast'
import { toastForEvent } from './ranking'
import { FRAME_SEPARATOR, STREAM_PATH, STREAM_STALL_MS, backoffMs, parseFrame } from './sse'
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
  // first as the cue to refetch — a reconnect may have missed pings while down.
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
    // Global reaction: an exception is the one signal a dispatcher must notice even
    // when not looking at that trip. What that alert says — and whether there is one
    // at all — is decided by toastForEvent, kept pure in ./ranking so it can be tested
    // without standing up an SSE stream and two context providers.
    const toast = toastForEvent(event)
    if (toast) notify(toast)
  }, [notify])

  useEffect(() => {
    // Only a signed-in dispatcher gets a connection. In practice this layout unmounts on
    // sign-out, so `enabled` is true whenever mounted; the guard is defensive.
    if (!enabled) return

    let cancelled = false
    let controller: AbortController | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    let stallTimer: ReturnType<typeof setTimeout> | null = null

    const clearRetry = () => {
      if (retryTimer) {
        clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const clearStall = () => {
      if (stallTimer) {
        clearTimeout(stallTimer)
        stallTimer = null
      }
    }

    // Any bytes, heartbeats included, prove the connection is alive; so does the server answering
    // the connection request at all. A connection that dies without
    // closing (a dropped network, a proxy holding the socket) would otherwise leave reader.read()
    // waiting forever with the badge still on "Live". Aborting rejects that read, and the catch in
    // openConnection reconnects.
    const armStall = (active: AbortController) => {
      clearStall()
      stallTimer = setTimeout(() => active.abort(), STREAM_STALL_MS)
    }

    const scheduleReconnect = () => {
      if (cancelled || document.hidden) return
      clearRetry()
      attempt += 1
      setStatus('reconnecting')
      retryTimer = setTimeout(openConnection, backoffMs(attempt))
    }

    const pump = async (body: ReadableStream<Uint8Array>, active: AbortController) => {
      const reader = body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        armStall(active)
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
      // Covers the wait for response headers too: a request the server never answers would
      // otherwise hang here with no reconnect. pump() re-arms it on every read once connected.
      armStall(controller)
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

        await pump(res.body, controller) // resolves when the server closes the stream
        clearStall()
        if (!cancelled) scheduleReconnect()
      } catch {
        clearStall()
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
        clearStall()
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
      clearStall()
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
