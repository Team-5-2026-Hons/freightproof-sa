import { act, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OfflineBanner } from '../OfflineBanner'
import { ApiError } from '@/lib/api/client'
import { setCustodyContext } from '@/lib/session/custody-context'
import { authenticateTestDriver } from '@/lib/session/testing/custody'
import { ROUTES } from '@/lib/constants/routes'
import { __resetOfflineQueueStoreForTests } from '@/lib/hooks/useOfflineQueue'
import {
  __setIndexedDbForTests,
  getExceptionEnvelope,
  saveExceptionEnvelope,
  type ExceptionEnvelope,
} from '@/lib/offline/exception-store'
import { createFakeIndexedDb } from '@/lib/offline/testing/fake-indexeddb'
import {
  startPhaseSubmission,
  __resetPhaseSubmitterForTests,
  type PhaseSubmissionRequest,
} from '@/lib/submission/phase-submitter'
import type { SubmitPhaseResult } from '@/lib/api/phases'

const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))

// OfflineBanner mounts useOfflineQueue() itself to read queueLength/
// attentionCount, so its mount-time flush() needs the same network mocks
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
  actorId: 'driver-1', custodySequence: null,
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
    driverCapturedAt: '2026-06-12T10:00:00Z',
    enqueuePhase: vi.fn(() => true), // stored, as the real queue answers when the phone has room
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
  // A phase can be handed off only after TripContext has loaded its trip scope.
  authenticateTestDriver('trip-1', 0)
})

afterEach(() => {
  vi.restoreAllMocks()
  __setIndexedDbForTests(null)
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
      // Two DIFFERENT trips, and that is load-bearing rather than incidental. This is a
      // TRANSIENT failure, and flushQueue now stalls a trip's remaining phase entries
      // behind one that fails transiently (useOfflineQueue.ts) — two entries sharing a
      // tripId would send once, not twice, and the wait below could never be satisfied.
      // Two trips is also the honest fixture for "more than one queued entry": the banner
      // counts the queue, not one trip's chain.
      // (The dropped-entry sibling below deliberately keeps ONE tripId — a terminal 4xx
      // disposes of the entry rather than leaving it pending, so it must NOT stall the
      // chain, and that test passing same-trip is what proves it.)
      seedQueue([PHASE_ENTRY, { ...PHASE_ENTRY, id: 'entry-2', tripId: 'trip-2' }])

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

  describe('retained phase notice', () => {
    it('shows a review notice after a terminal refusal and keeps the evidence', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValue(new ApiError(422, 'invalid evidence'))
      seedQueue([PHASE_ENTRY])
      render(<OfflineBanner />)

      await screen.findByText(/1 item needs attention/i)
      expect(screen.getByRole('alert')).toHaveTextContent(/kept on this phone. Nothing was deleted/i)
      expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([
        expect.objectContaining({ status: 'needs-attention', evidence: PHASE_ENTRY.evidence }),
      ])
      fireEvent.click(screen.getByRole('button', { name: 'Review' }))
      expect(push).toHaveBeenCalledWith(ROUTES.retainedEvidence)
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })

    it('stays silent only when a coded duplicate proves the capture was already recorded', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValue(new ApiError(409, 'Already recorded', undefined, {
        code: 'EVIDENCE_ALREADY_RECORDED', requestId: null, currentVersion: null, evidenceId: 'receipt-1',
      }))
      seedQueue([PHASE_ENTRY])
      render(<OfflineBanner />)

      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toEqual([]))
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('uses plural phrasing for more than one refused item', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      vi.mocked(submitPhase).mockRejectedValue(new ApiError(422, 'invalid evidence'))
      // Each trip can be attempted independently; a refusal stalls its own phase chain.
      seedQueue([PHASE_ENTRY, { ...PHASE_ENTRY, id: 'entry-2', tripId: 'trip-2' }])
      render(<OfflineBanner />)

      expect(await screen.findByText(/2 items need attention/i)).toBeInTheDocument()
      expect(JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')).toHaveLength(2)
    })
  })

  // Workstream 1: the driver is sent Home the instant they swipe, so the only place that
  // can honestly say "this is still going" — or "this never landed" — is here.
  describe('background phase submissions', () => {
    it('hides an old custody marker and its late failure without remounting the banner', async () => {
      const { submitPhase } = await import('@/lib/api/phases')
      let reject!: (error: Error) => void
      vi.mocked(submitPhase).mockImplementationOnce(() => new Promise((_resolve, refuse) => { reject = refuse }))
      let finish!: () => void
      const outcome = new Promise<void>(resolve => { finish = resolve })
      render(<OfflineBanner />)
      act(() => { startPhaseSubmission(phaseSubmission({ onOutcome: finish })) })
      expect(await screen.findByText(/^Recording evidence…$/)).toBeInTheDocument()
      await waitFor(() => expect(submitPhase).toHaveBeenCalledTimes(1))

      act(() => { setCustodyContext({ actorId: 'driver-1', tripId: 'trip-1', custodySequence: 2 }) })
      await waitFor(() => expect(screen.queryByText(/recording evidence/i)).not.toBeInTheDocument())
      await act(async () => { reject(new ApiError(422, 'Old period refused')); await outcome })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

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
  // Exception reports the server refused sit in IndexedDB as "needs attention". They are
  // never auto-deleted, so the banner must say so and give the driver the two real choices.
  describe('needs-attention notice', () => {
    function attentionEnvelope(clientReportId: string): ExceptionEnvelope {
      return {
        clientReportId,
        actorId: 'driver-1',
        tripId: 'trip-1',
        body: { exception_type: 'cargo_damage', description: 'Pallet crushed', client_report_id: clientReportId },
        photos: [],
        status: 'needs-attention',
        attentionReason: 'Description too long',
        attentionPhotoId: null,
        createdAt: '2026-09-05T09:00:00.000Z',
        updatedAt: '2026-09-05T09:00:00.000Z',
      }
    }

    beforeEach(() => {
      __setIndexedDbForTests(createFakeIndexedDb())
    })

    it('shows an alert row with Try again and Review as real 44pt buttons', async () => {
      await saveExceptionEnvelope(attentionEnvelope('report-1'))

      render(<OfflineBanner />)

      const alert = await screen.findByText(/1 item needs attention/i)
      expect(alert.closest('[role="alert"]')).toHaveTextContent(/kept on this phone\. Nothing was deleted\./i)
      for (const name of ['Try again', 'Review']) {
        const button = screen.getByRole('button', { name })
        expect(button.tagName).toBe('BUTTON')
        expect(button).toHaveClass('min-h-11')
      }
    })

    it('uses plural phrasing for more than one report', async () => {
      await saveExceptionEnvelope(attentionEnvelope('report-1'))
      await saveExceptionEnvelope(attentionEnvelope('report-2'))

      render(<OfflineBanner />)

      expect(await screen.findByText(/2 items need attention/i)).toBeInTheDocument()
    })

    it('Try again resets the reports and sends them', async () => {
      const { raiseException } = await import('@/lib/api/exceptions')
      await saveExceptionEnvelope(attentionEnvelope('report-1'))
      render(<OfflineBanner />)
      await screen.findByText(/1 item needs attention/i)

      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

      await waitFor(() => expect(raiseException).toHaveBeenCalledTimes(1))
      await waitFor(() => expect(screen.queryByText(/need(s)? attention/i)).not.toBeInTheDocument())
      expect(await getExceptionEnvelope('report-1')).toBeNull()
    })

    it('Review opens retained evidence without deleting or sending the report', async () => {
      const { raiseException } = await import('@/lib/api/exceptions')
      await saveExceptionEnvelope(attentionEnvelope('report-1'))
      render(<OfflineBanner />)
      await screen.findByText(/1 item needs attention/i)

      fireEvent.click(screen.getByRole('button', { name: 'Review' }))

      expect(push).toHaveBeenCalledWith(ROUTES.retainedEvidence)
      expect(await getExceptionEnvelope('report-1')).toMatchObject({ status: 'needs-attention' })
      expect(raiseException).not.toHaveBeenCalled()
    })

    it('offers no bulk delete control for retained evidence', async () => {
      await saveExceptionEnvelope(attentionEnvelope('report-1'))
      await saveExceptionEnvelope(attentionEnvelope('report-2'))
      render(<OfflineBanner />)
      await screen.findByText(/2 items need attention/i)

      expect(screen.queryByRole('button', { name: /dismiss|delete/i })).not.toBeInTheDocument()
      expect(await getExceptionEnvelope('report-1')).not.toBeNull()
      expect(await getExceptionEnvelope('report-2')).not.toBeNull()
    })

    it('shows no attention row when nothing needs attention', async () => {
      const { container } = render(<OfflineBanner />)

      await waitFor(() => expect(container).toBeEmptyDOMElement())
      expect(screen.queryByText(/need(s)? attention/i)).not.toBeInTheDocument()
    })
  })
})
