import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OfflineBanner } from '../OfflineBanner'
import { ApiError } from '@/lib/api/client'
import { __resetOfflineQueueStoreForTests } from '@/lib/hooks/useOfflineQueue'

// OfflineBanner now mounts useOfflineQueue() itself (Fix 3) to read queueLength/
// droppedCount, so its mount-time flush() needs the same network mocks
// useOfflineQueue.test.ts uses — otherwise these tests would hit a real fetch.
vi.mock('@/lib/api/handshakes', () => ({
  submitHandshake: vi.fn().mockResolvedValue({ ok: true, eventHash: 'abc', trip: null }),
}))
vi.mock('@/lib/api/exceptions', () => ({
  raiseException: vi.fn().mockResolvedValue({ id: 'exc-1' }),
}))
vi.mock('@/lib/api/checkpoints', () => ({
  submitCheckpoint: vi.fn().mockResolvedValue({ id: 'cp-1' }),
}))

// jsdom defaults navigator.onLine to true; each test overrides the getter so the
// component's useSyncExternalStore snapshot reads the state we want.
function setOnline(online: boolean) {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online)
}

function seedQueue(entries: unknown[]) {
  localStorage.setItem('fp_offline_queue', JSON.stringify(entries))
}

const HANDSHAKE_ENTRY = {
  kind: 'handshake', id: 'entry-1', tripId: 'trip-1', handshakeType: 'origin_gate_in',
  evidence: { gpsLat: -26.09, gpsLng: 28.13, gateAddress: null, capturedAt: '2026-06-12T10:00:00Z' },
  enqueuedAt: '2026-06-12T10:00:00Z',
}

beforeEach(() => {
  setOnline(true)
  localStorage.clear()
  __resetOfflineQueueStoreForTests()
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('OfflineBanner', () => {
  it('renders nothing while online with an empty queue', async () => {
    const { container } = render(<OfflineBanner />)

    // Let the mount-time flush (empty queue, no-op) settle before asserting.
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('shows the offline status message while offline', () => {
    setOnline(false)

    render(<OfflineBanner />)

    expect(screen.getByText(/offline — evidence you capture is saved on this device/i)).toBeInTheDocument()
  })

  it('appears when the browser fires an offline event', () => {
    setOnline(true)
    render(<OfflineBanner />)
    expect(screen.queryByText(/offline — evidence you capture/i)).not.toBeInTheDocument()

    setOnline(false)
    fireEvent(window, new Event('offline'))

    expect(screen.getByText(/offline — evidence you capture/i)).toBeInTheDocument()
  })

  it('disappears when connectivity comes back and nothing is queued', () => {
    setOnline(false)
    render(<OfflineBanner />)
    expect(screen.getByText(/offline — evidence you capture/i)).toBeInTheDocument()

    setOnline(true)
    fireEvent(window, new Event('online'))

    expect(screen.queryByText(/offline — evidence you capture/i)).not.toBeInTheDocument()
  })

  // Fix 3a: queueLength was already returned by the hook but rendered nowhere. A driver
  // back online with a pending item had no signal that anything was still in flight.
  describe('pending-sync indicator', () => {
    it('shows a singular "item waiting to sync" message while online with one queued entry', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      // Transient (non-ApiError) failure — entry stays queued after the mount flush
      // resolves, so the indicator has something stable to assert against.
      vi.mocked(submitHandshake).mockRejectedValue(new Error('network down'))
      seedQueue([HANDSHAKE_ENTRY])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitHandshake).toHaveBeenCalledTimes(1))
      expect(screen.getByText(/1 item waiting to sync/i)).toBeInTheDocument()
    })

    it('shows a plural "items waiting to sync" message for more than one queued entry', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      vi.mocked(submitHandshake).mockRejectedValue(new Error('network down'))
      seedQueue([HANDSHAKE_ENTRY, { ...HANDSHAKE_ENTRY, id: 'entry-2' }])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitHandshake).toHaveBeenCalledTimes(2))
      expect(screen.getByText(/2 items waiting to sync/i)).toBeInTheDocument()
    })

    it('hides the pending-sync indicator once the queue empties', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      // Default mock resolves successfully — the seeded entry flushes away on mount.
      seedQueue([HANDSHAKE_ENTRY])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitHandshake).toHaveBeenCalledTimes(1))
      expect(screen.queryByText(/waiting to sync/i)).not.toBeInTheDocument()
    })
  })

  // Fix 3b: a terminal non-409 drop used to be console.warn-only — invisible to the
  // driver even though their captured evidence was permanently discarded.
  describe('dropped-entry notice', () => {
    it('shows a dismissible notice after a non-409 terminal drop, and dismissing clears it', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      vi.mocked(submitHandshake).mockRejectedValue(new ApiError(422, 'invalid evidence'))
      seedQueue([HANDSHAKE_ENTRY])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitHandshake).toHaveBeenCalledTimes(1))
      expect(screen.getByRole('alert')).toHaveTextContent(
        /1 item could not be synced and was removed — contact your dispatcher/i,
      )

      fireEvent.click(screen.getByRole('button', { name: /dismiss sync failure notice/i }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('stays silent on a 409 drop — that means an earlier attempt already succeeded', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      vi.mocked(submitHandshake).mockRejectedValue(new ApiError(409, 'already submitted'))
      seedQueue([HANDSHAKE_ENTRY])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitHandshake).toHaveBeenCalledTimes(1))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('uses plural phrasing for more than one dropped entry', async () => {
      const { submitHandshake } = await import('@/lib/api/handshakes')
      vi.mocked(submitHandshake).mockRejectedValue(new ApiError(422, 'invalid evidence'))
      seedQueue([HANDSHAKE_ENTRY, { ...HANDSHAKE_ENTRY, id: 'entry-2' }])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitHandshake).toHaveBeenCalledTimes(2))
      expect(screen.getByRole('alert')).toHaveTextContent(
        /2 items could not be synced and were removed — contact your dispatcher/i,
      )
    })
  })
})
