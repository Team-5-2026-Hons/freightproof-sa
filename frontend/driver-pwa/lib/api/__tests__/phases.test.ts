// frontend/driver-pwa/lib/api/__tests__/phases.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type {
  ActivationEvidence, ConfirmationEvidence, DepartureEvidence, LoadingEvidence, UnloadingEvidence,
} from '@/lib/types/evidence-draft'

// submitPhase reads NEXT_PUBLIC_DEMO_MODE at module load time (IS_DEMO_MODE
// constant), so it must be set to 'false' before the module is imported in
// order to exercise the real-backend branch.
vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockPost = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: (...args: unknown[]) => mockPost(...args), postForm: vi.fn() },
}))

// uploadArtifact's data-URL -> Blob conversion is jsdom-incompatible (fetch('data:...')
// doesn't yield a FormData-appendable Blob in jsdom) and isn't what this file tests —
// mock it directly so these tests focus on phases.ts's orchestration logic.
const mockUploadArtifact = vi.fn()
vi.mock('@/lib/api/artifacts', () => ({
  uploadArtifact: (...args: unknown[]) => mockUploadArtifact(...args),
}))

const ACTIVATION_EVIDENCE: ActivationEvidence = {
  gpsLat: -26.09,
  gpsLng: 28.13,
  gateAddress: null,
  capturedAt: '2026-06-12T10:00:00Z',
}

const LOADING_EVIDENCE: LoadingEvidence = {
  driverVisualCount: 31,
  capturedAt: '2026-06-12T10:05:00Z',
}

const DEPARTURE_EVIDENCE: DepartureEvidence = {
  gpsLat: -26.09,
  gpsLng: 28.13,
  waybillPhotoDataUrl: 'data:image/jpeg;base64,BBBB',
  sealNumber: 'AB-1234',
  sealPhotoDataUrl: 'data:image/jpeg;base64,CCCC',
  sealNumberConfirmed: ' AB-1234 ',
  sealVerifiedMatch: true,
  capturedAt: '2026-06-12T10:10:00Z',
}

const UNLOADING_EVIDENCE: UnloadingEvidence = {
  waybillHandedOver: true,
  sealNumberAtDestination: 'AB-1234',
  sealVerifiedMatch: true,
  sealBrokenPhotoDataUrl: 'data:image/jpeg;base64,DDDD',
  driverVisualCount: 31,
  capturedAt: '2026-06-12T10:20:00Z',
}

const CONFIRMATION_EVIDENCE: ConfirmationEvidence = {
  podPhotoDataUrl: 'data:image/jpeg;base64,EEEE',
  podSignatureDataUrl: 'data:image/png;base64,FFFF',
  // Stands in for a value carried forward from the preceding UnloadingEvidence draft —
  // see lib/types/evidence-draft.ts's header comment.
  driverVisualCount: 31,
  reconciliationNote: null,
  capturedAt: '2026-06-12T10:25:00Z',
}

const IDEMPOTENCY_KEY = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

describe('submitPhase (real-backend branch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes activation with GPS only, no artifact upload', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    const result = await submitPhase('trip-1', 'phase-event-1', 'activation', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY)

    expect(result.ok).toBe(true)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-1/complete',
      {
        phase_type: 'activation',
        driver_phone_lat: -26.09,
        driver_phone_lng: 28.13,
        idempotency_key: IDEMPOTENCY_KEY,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('completes loading with only a visual count, no artifact upload', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, IDEMPOTENCY_KEY)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-2/complete',
      {
        phase_type: 'loading',
        driver_visual_count: 31,
        idempotency_key: IDEMPOTENCY_KEY,
      },
      { timeoutMs: 30_000 },
    )
  })

  // Parent plan's flagged 🔴 risk: the seal moved from `loading` to `departure` (D7/T5).
  // A stale field or a silently-null seal here would let a NULL == NULL comparison
  // pass server-side without raising anything and without failing any test — this
  // proves the seal captured IN the departure draft is exactly what departure submits.
  it('uploads waybill and seal photos then completes departure with the seal captured there — not loading', async () => {
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'waybill-artifact', file_hash: 'a'.repeat(64) })
      .mockResolvedValueOnce({ id: 'seal-artifact', file_hash: 'b'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-3', 'departure', DEPARTURE_EVIDENCE, IDEMPOTENCY_KEY)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(2)
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-3/complete',
      {
        phase_type: 'departure',
        waybill_photo_artifact_id: 'waybill-artifact',
        seal_number: 'AB-1234',
        seal_photo_artifact_id: 'seal-artifact',
        guard_verified_seal: true,
        seal_number_confirmed: 'AB-1234',
        idempotency_key: IDEMPOTENCY_KEY,
      },
      { timeoutMs: 30_000 },
    )
  })

  // The NULL == NULL trap, guarded directly: a departure draft with no seal captured
  // must never reach the wire as a null/undefined seal_number — it must fail loudly
  // client-side instead, before any request is sent.
  it('throws instead of submitting when the departure evidence has no seal number', async () => {
    const { submitPhase } = await import('../phases')
    const incomplete: DepartureEvidence = { ...DEPARTURE_EVIDENCE, sealNumber: null }

    await expect(
      submitPhase('trip-1', 'phase-event-3', 'departure', incomplete, IDEMPOTENCY_KEY),
    ).rejects.toThrow(/Departure evidence incomplete/)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('completes unloading with the confirmed seal for server-side comparison, no artifact upload', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-4', 'unloading', UNLOADING_EVIDENCE, IDEMPOTENCY_KEY)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-4/complete',
      {
        phase_type: 'unloading',
        seal_number_at_destination: 'AB-1234',
        idempotency_key: IDEMPOTENCY_KEY,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('uploads POD photo and signature then completes confirmation with the carried-forward visual count', async () => {
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'pod-photo-artifact', file_hash: 'a'.repeat(64) })
      .mockResolvedValueOnce({ id: 'pod-signature-artifact', file_hash: 'b'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-5', 'confirmation', CONFIRMATION_EVIDENCE, IDEMPOTENCY_KEY)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(2)
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-5/complete',
      {
        phase_type: 'confirmation',
        pod_photo_artifact_id: 'pod-photo-artifact',
        pod_signature_artifact_id: 'pod-signature-artifact',
        driver_visual_count: 31,
        pp_scan_in_count: 31,
        idempotency_key: IDEMPOTENCY_KEY,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('throws when required evidence is missing instead of calling the backend', async () => {
    const { submitPhase } = await import('../phases')
    const incomplete: ActivationEvidence = { ...ACTIVATION_EVIDENCE, gpsLat: null }

    await expect(
      submitPhase('trip-1', 'phase-event-1', 'activation', incomplete, IDEMPOTENCY_KEY),
    ).rejects.toThrow(/Activation evidence incomplete/)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('propagates a backend rejection from the artifact upload', async () => {
    mockUploadArtifact.mockRejectedValue(new Error('upload failed: HTTP 500'))

    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-3', 'departure', DEPARTURE_EVIDENCE, IDEMPOTENCY_KEY),
    ).rejects.toThrow(/upload failed/)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('rejects trip_creation and in_transit — neither is ever completed by a driver action', async () => {
    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-0', 'trip_creation', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY),
    ).rejects.toThrow(/never completed by a driver action/)
    await expect(
      submitPhase('trip-1', 'phase-event-6', 'in_transit', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY),
    ).rejects.toThrow(/never completed by a driver action/)
    expect(mockPost).not.toHaveBeenCalled()
  })

  // Task 5.3: the idempotency key is caller-supplied and must be sent verbatim,
  // unchanged across a caller-driven retry of the same logical submission.
  it('sends the exact idempotency_key it was given, unchanged from the caller', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, 'retry-key-123')
    await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, 'retry-key-123')

    expect(mockPost).toHaveBeenCalledTimes(2)
    const [firstCallBody] = mockPost.mock.calls[0].slice(1)
    const [secondCallBody] = mockPost.mock.calls[1].slice(1)
    expect((firstCallBody as { idempotency_key: string }).idempotency_key).toBe('retry-key-123')
    expect((secondCallBody as { idempotency_key: string }).idempotency_key).toBe('retry-key-123')
  })

  // The server dedupes a replay of an already-resolved phase (`_gate_and_load`,
  // phase_service.py:108-134) and still returns 200 with the current trip — this
  // proves the client reads the ADDRESSED phase's real status off that response
  // rather than assuming a 200 means fresh work happened.
  it('surfaces the addressed phase\'s own status from the response instead of assuming a fresh completion', async () => {
    mockPost.mockResolvedValue({
      id: 'trip-1',
      phases: [
        { phase_event_id: 'phase-event-2', status: 'completed' },
        { phase_event_id: 'other-phase', status: 'pending' },
      ],
    })

    const { submitPhase } = await import('../phases')
    const result = await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, IDEMPOTENCY_KEY)

    expect(result.ok).toBe(true)
    expect(result.phaseStatus).toBe('completed')
  })

  it('surfaces an exception status the same way, rather than reporting it as a plain success', async () => {
    mockPost.mockResolvedValue({
      id: 'trip-1',
      phases: [{ phase_event_id: 'phase-event-4', status: 'exception' }],
    })

    const { submitPhase } = await import('../phases')
    const result = await submitPhase('trip-1', 'phase-event-4', 'unloading', UNLOADING_EVIDENCE, IDEMPOTENCY_KEY)

    expect(result.ok).toBe(true)
    expect(result.phaseStatus).toBe('exception')
  })
})

describe('submitPhase (demo-mode gate)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('short-circuits with a fake success in demo mode instead of hitting the network', async () => {
    vi.doMock('@/lib/constants/env', () => ({ IS_DEMO_MODE: true }))
    const demoMockPost = vi.fn()
    vi.doMock('@/lib/api/client', () => ({
      api: { get: vi.fn(), post: (...args: unknown[]) => demoMockPost(...args), postForm: vi.fn() },
    }))
    vi.doMock('@/lib/api/artifacts', () => ({ uploadArtifact: vi.fn() }))

    const { submitPhase } = await import('../phases')
    const promise = submitPhase('trip-1', 'phase-event-1', 'activation', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(result).toEqual({ ok: true, trip: null, phaseStatus: 'completed' })
    expect(demoMockPost).not.toHaveBeenCalled()
  })
})
