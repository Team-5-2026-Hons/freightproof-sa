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

type Listener = (event: RealtimeEvent) => void

interface RealtimeContextValue {
  status: RealtimeStatus
  subscribe: (listener: Listener) => () => void
  reconnectNonce: number
}

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
    listenersRef.current.forEach(listener => listener(event))
    const toast = toastForEvent(event)
    if (toast) notify(toast)
  }, [notify])

  useEffect(() => {
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
      armStall(controller)
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
        setReconnectNonce(n => n + 1)

        await pump(res.body, controller)
        clearStall()
        if (!cancelled) scheduleReconnect()
      } catch {
        clearStall()
        if (!cancelled && !document.hidden) scheduleReconnect()
      }
    }

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

export function useRealtimeChannel(): RealtimeContextValue {
  return useContext(RealtimeContext)
}

export function useRealtimeStatus(): RealtimeStatus {
  return useContext(RealtimeContext).status
}
