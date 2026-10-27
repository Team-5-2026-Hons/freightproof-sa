import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RealtimeProvider, useRealtimeChannel } from './RealtimeProvider'
import { BACKOFF_MAX_MS, STREAM_STALL_MS } from './sse'

const auth = { user: { id: 'dispatcher-1' } }
const toast = { notify: vi.fn() }
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => auth }))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => toast }))
vi.mock('@/lib/supabase/client', () => ({ getAccessToken: () => 'token' }))
vi.mock('@/lib/api/client', () => ({ BASE_URL: 'http://api.test' }))

const HEARTBEAT_MS = 15_000
const encoder = new TextEncoder()

let streams: ReadableStreamDefaultController<Uint8Array>[] = []
function openStream(init: RequestInit): Promise<Response> {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streams.push(controller)
      controller.enqueue(encoder.encode(': connected\n\n'))
      init.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')))
    },
  })
  return Promise.resolve(new Response(body, { status: 200 }))
}
const openStreamFetch = (_url: string, init: RequestInit): Promise<Response> => openStream(init)
const fetchMock = vi.fn(openStreamFetch)

function StatusProbe() {
  return <span data-testid="status">{useRealtimeChannel().status}</span>
}

async function advance(ms: number): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  streams = []
  fetchMock.mockReset().mockImplementation(openStreamFetch)
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('RealtimeProvider stall watchdog', () => {
  it('drops a connection that goes silent and reconnects, instead of staying "live"', async () => {
    render(<RealtimeProvider><StatusProbe /></RealtimeProvider>)
    await advance(0)
    expect(screen.getByTestId('status')).toHaveTextContent('live')

    await advance(STREAM_STALL_MS)

    expect(screen.getByTestId('status')).toHaveTextContent('reconnecting')

    await advance(BACKOFF_MAX_MS)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('status')).toHaveTextContent('live')
  })

  it('abandons a connection request the server never answers, and retries', async () => {
    let attempts = 0
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      attempts += 1
      if (attempts > 1) return openStream(init)
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })
    render(<RealtimeProvider><StatusProbe /></RealtimeProvider>)

    await advance(STREAM_STALL_MS)

    expect(screen.getByTestId('status')).toHaveTextContent('reconnecting')

    await advance(BACKOFF_MAX_MS)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.getByTestId('status')).toHaveTextContent('live')
  })

  it('stays live while heartbeats keep arriving', async () => {
    render(<RealtimeProvider><StatusProbe /></RealtimeProvider>)
    await advance(0)

    for (let beat = 0; beat < 4; beat++) {
      await advance(HEARTBEAT_MS)
      act(() => { streams[0].enqueue(encoder.encode(': heartbeat\n\n')) })
    }

    expect(screen.getByTestId('status')).toHaveTextContent('live')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
