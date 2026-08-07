import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OfflineBanner } from '../OfflineBanner'
import { ApiError } from '@/lib/api/client'
import { __resetOfflineQueueStoreForTests } from '@/lib/hooks/useOfflineQueue'
import {
  startPhaseSubmission,
  __resetPhaseSubmitterForTests,
  type PhaseSubmissionRequest,
} from '@/lib/submission/phase-submitter'
import type { SubmitPhaseResult } from '@/lib/api/phases'

// OfflineBanner now mounts useOfflineQueue() itself (Fix 3) to read queueLength/
// droppedCount, so its mount-time flush() needs the same network mocks
// useOfflineQueue.test.ts uses — otherwise these tests would hit a real fetch.
// lib/api/handshakes.ts (submitHandshake) is deleted — useOfflineQueue's sendEntry
// now calls submitPhase from lib/api/phases.ts for a 'phase'-kind queue entry.
vi.mock('@/lib/api/phases', () => ({
  submitPhase: vi.fn().mockResolvedValue({ ok: true, trip: null, phaseStatus: 'completed' }),
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

// Shape mirrors useOfflineQueue.ts's PhaseQueueEntry — kind 'phase', addressed by
// phaseEventId + phaseType (not a bare handshakeType), carrying its own idempotencyKey.
const PHASE_ENTRY = {
  kind: 'phase', id: 'entry-1', tripId: 'trip-1', phaseEventId: 'phase-event-1', phaseType: 'activation',
  evidence: { gpsLat: -26.09, gpsLng: 28.13, gateAddress: null, capturedAt: '2026-06-12T10:00:00Z' },
  idempotencyKey: 'entry-1',
  enqueuedAt: '2026-06-12T10:00:00Z',
}

// Workstream 1: a phase submission now outlives the step screen that started it, so the
// banner — which AppShell renders on every screen — is where its progress and its
// terminal failures have to surface. Requests are built here rather than driven through
// the page so these stay banner tests.
function phaseSubmission(overrides: Partial<PhaseSubmissionRequest> = {}): PhaseSubmissionRequest {
  return {
    tripId: 'trip-1',
    phaseEventId: 'phase-event-1',
    phaseType: 'loading',
    // loading no longer captures anything itself (the linehaul step is read-only) —
    // capturedAt alone is a valid LoadingEvidence.
    evidence: { capturedAt: '2026-06-12T10:00:00Z' },
    idempotencyKey: 'idem-1',
    position: Promise.resolve(null),
    enqueuePhase: vi.fn(),
    refetchTrip: vi.fn().mockResolvedValue(null),
    onOutcome: vi.fn(),
    ...overrides,
  }
}

beforeEach(() => {
  setOnline(true)
  localStorage.clear()
  __resetOfflineQueueStoreForTests()
  __resetPhaseSubmitterForTests()
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
      const { submitPhase } = await import('@/lib/api/phases')
      // Transient (non-ApiError) failure — entry stays queued after the mount flush
      // resolves, so the indicator has something stable to assert against.
      vi.mocked(submitPhase).mockRejectedValue(new Error('network down'))
      seedQueue([PHASE_ENTRY])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
      expect(screen.getByText(/1 item waiting to sync/i)).toBeInTheDocument()
    })

    it('shows a plural "items waiting to sync" message for more than one queued entry', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValue(new Error('network down'))
      seedQueue([PHASE_ENTRY, { ...PHASE_ENTRY, id: 'entry-2' }])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(2))
      expect(screen.getByText(/2 items waiting to sync/i)).toBeInTheDocument()
    })

    it('hides the pending-sync indicator once the queue empties', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      // Default mock resolves successfully — the seeded entry flushes away on mount.
      seedQueue([PHASE_ENTRY])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
      expect(screen.queryByText(/waiting to sync/i)).not.toBeInTheDocument()
    })
  })

  // Fix 3b: a terminal non-409 drop used to be console.warn-only — invisible to the
  // driver even though their captured evidence was permanently discarded.
  describe('dropped-entry notice', () => {
    it('shows a dismissible notice after a non-409 terminal drop, and dismissing clears it', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValue(new ApiError(422, 'invalid evidence'))
      seedQueue([PHASE_ENTRY])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
      expect(screen.getByRole('alert')).toHaveTextContent(
        /1 item could not be synced and was removed\. Contact your dispatcher/i,
      )

      fireEvent.click(screen.getByRole('button', { name: /dismiss sync failure notice/i }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('stays silent on a 409 drop — that means an earlier attempt already succeeded', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValue(new ApiError(409, 'already submitted'))
      seedQueue([PHASE_ENTRY])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('uses plural phrasing for more than one dropped entry', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValue(new ApiError(422, 'invalid evidence'))
      seedQueue([PHASE_ENTRY, { ...PHASE_ENTRY, id: 'entry-2' }])

      render(<OfflineBanner />)

      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(2))
      expect(screen.getByRole('alert')).toHaveTextContent(
        /2 items could not be synced and were removed\. Contact your dispatcher/i,
      )
    })
  })

  // Workstream 1: the driver is sent Home the instant they swipe, so the only place that
  // can honestly say "this is still going" — or "this never landed" — is here.
  describe('background phase submissions', () => {
    it('shows a recording indicator while a handed-off submission is in flight, and hides it once it settles', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      let resolveSubmit: (value: SubmitPhaseResult) => void = () => {}
      vi.mocked(submitPhase).mockReturnValue(new Promise((resolve) => { resolveSubmit = resolve }))

      render(<OfflineBanner />)
      expect(screen.queryByText(/recording evidence/i)).not.toBeInTheDocument()

      act(() => { startPhaseSubmission(phaseSubmission()) })
      expect(await screen.findByText(/^Recording evidence…$/)).toBeInTheDocument()

      await act(async () => {
        resolveSubmit({ ok: true, trip: null, phaseStatus: 'completed' })
      })
      await waitFor(() => expect(screen.queryByText(/recording evidence/i)).not.toBeInTheDocument())
    })

    it('counts concurrent submissions rather than claiming there is only one', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockReturnValue(new Promise(() => {}))

      render(<OfflineBanner />)
      act(() => {
        startPhaseSubmission(phaseSubmission())
        startPhaseSubmission(phaseSubmission({ phaseEventId: 'phase-event-2', phaseType: 'departure' }))
      })

      expect(await screen.findByText(/Recording evidence for 2 phases…/)).toBeInTheDocument()
    })

    it('raises a persistent, dismissible notice when a submission fails terminally', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      // A 422 can never succeed on retry, so it is never queued — without this notice the
      // driver would be on Home believing evidence was recorded when it was not.
      vi.mocked(submitPhase).mockRejectedValue(new ApiError(422, 'visual count is required.'))

      render(<OfflineBanner />)
      await act(async () => { startPhaseSubmission(phaseSubmission()) })

      const notice = await screen.findByRole('alert')
      expect(notice).toHaveTextContent(/Loading was not recorded: visual count is required\./i)
      expect(notice).toHaveTextContent(/still saved on this device/i)

      fireEvent.click(screen.getByRole('button', { name: /dismiss loading failure notice/i }))

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('stays silent when the failure was queued for retry instead — that evidence is not lost', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValue(new TypeError('network down'))

      render(<OfflineBanner />)
      await act(async () => { startPhaseSubmission(phaseSubmission()) })

      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })
  })
})
