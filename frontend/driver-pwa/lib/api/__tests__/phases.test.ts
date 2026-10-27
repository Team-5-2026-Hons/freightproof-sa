// frontend/driver-pwa/lib/api/__tests__/phases.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { DriverPosition } from '@/lib/types/location'
import type {
  ActivationEvidence, ArrivalEvidence, ConfirmationEvidence, DepartureEvidence, LoadingEvidence, UnloadingEvidence,
} from '@/lib/types/evidence-draft'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockPost = vi.fn()
const { MockApiError } = vi.hoisted(() => ({
  MockApiError: class MockApiError extends Error {
    constructor(public readonly status: number, message: string) {
      super(message)
      this.name = 'ApiError'
    }
  },
}))
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: (...args: unknown[]) => mockPost(...args), postForm: vi.fn() },
  ApiError: MockApiError,
}))

const mockUploadArtifact = vi.fn()
vi.mock('@/lib/api/artifacts', () => ({
  uploadArtifact: (...args: unknown[]) => mockUploadArtifact(...args),
}))

const ACTIVATION_EVIDENCE: ActivationEvidence = {
  capturedAt: '2026-06-12T10:00:00Z',
}

const POSITION: DriverPosition = { lat: -26.09, lng: 28.13, accuracyM: 8 }

const LOADING_EVIDENCE: LoadingEvidence = {
  linehaulPhotoDataUrl: null,
  linehaulPhotoArtifactId: null,
  capturedAt: '2026-06-12T10:05:00Z',
}

const DEPARTURE_EVIDENCE: DepartureEvidence = {
  sealPhotoArtifactId: null,
  sealNumber: 'AB-1234',
  sealPhotoDataUrl: 'data:image/jpeg;base64,CCCC',
  capturedAt: '2026-06-12T10:10:00Z',
}

const LEGACY_QUEUED_DEPARTURE_EVIDENCE = {
  ...DEPARTURE_EVIDENCE,
  waybillPhotoDataUrl: 'data:image/jpeg;base64,BBBB',
  waybillPhotoArtifactId: null,
} satisfies DepartureEvidence & { waybillPhotoDataUrl: string; waybillPhotoArtifactId: string | null }

const UNLOADING_EVIDENCE: UnloadingEvidence = {
  waybillHandedOver: true,
  driverVisualCount: 31,
  capturedAt: '2026-06-12T10:20:00Z',
}

const ARRIVAL_EVIDENCE: ArrivalEvidence = {
  sealCondition: 'intact',
  sealNumberAtArrival: 'AB-1234',
  sealPhotoDataUrl: 'data:image/jpeg;base64,CCCC',
  sealPhotoArtifactId: null,
  capturedAt: '2026-06-12T10:20:00Z',
}

const CONFIRMATION_EVIDENCE: ConfirmationEvidence = {
  podPhotoArtifactId: null,
  podSignatureArtifactId: 'receiver-signature-artifact',
  podPhotoDataUrl: 'data:image/jpeg;base64,EEEE',
  receiverConfirmedAt: '2026-09-13T10:05:00.000Z',
  driverVisualCount: 31,
  reconciliationNote: null,
  capturedAt: '2026-06-12T10:25:00Z',
}

const IDEMPOTENCY_KEY = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'

const DRIVER_CAPTURED_AT = '2026-06-12T10:30:00Z'

describe('submitPhase (real-backend branch)', () => {
  it('sends a warning acknowledgement separately from the captured location and never sends an assessment', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    const { submitPhase } = await import('../phases')

    await submitPhase(
      'trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT,
      { acknowledgedAt: '2026-06-12T10:31:00Z', reason: 'Truck is waiting at the gate.' },
    )

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-2/complete',
      expect.objectContaining({
        location_warning_acknowledged_at: '2026-06-12T10:31:00Z',
        location_warning_reason: 'Truck is waiting at the gate.',
      }),
      { timeoutMs: 30_000 },
    )
    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('action_location_assessment')
  })
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes activation with GPS only, no artifact upload', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    const result = await submitPhase('trip-1', 'phase-event-1', 'activation', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(result.ok).toBe(true)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-1/complete',
      {
        phase_type: 'activation',
        driver_phone_lat: -26.09,
        driver_phone_lng: 28.13,
        driver_accuracy_metres: 8,
        idempotency_key: IDEMPOTENCY_KEY,
        driver_captured_at: DRIVER_CAPTURED_AT,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('sends the linehaul PDF id next to the scan image', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', {
      linehaulPhotoDataUrl: 'data:image/jpeg;base64,AAAA', linehaulPhotoArtifactId: 'scan-artifact',
      linehaulPdfDataUrl: 'data:application/pdf;base64,JVBERi0=', linehaulPdfArtifactId: 'pdf-artifact',
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost.mock.calls[0][1]).toMatchObject({
      linehaul_photo_artifact_id: 'scan-artifact', linehaul_pdf_artifact_id: 'pdf-artifact',
    })
  })

  it('uploads the PDF at submit as a document when the early upload never landed', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact.mockResolvedValue({ id: 'late-pdf' })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', {
      linehaulPhotoDataUrl: 'data:image/jpeg;base64,AAAA', linehaulPhotoArtifactId: 'scan-artifact',
      linehaulPdfDataUrl: 'data:application/pdf;base64,JVBERi0=', linehaulPdfArtifactId: null,
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactType: 'document', attribution: { phaseEventId: 'phase-event-2', role: 'linehaul_pdf' },
    }))
    expect(mockPost.mock.calls[0][1]).toMatchObject({ linehaul_pdf_artifact_id: 'late-pdf' })
  })

  it('sends the PDF id an early upload produced even after the queue dropped the PDF image', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', {
      linehaulPhotoDataUrl: 'data:image/jpeg;base64,AAAA', linehaulPhotoArtifactId: 'scan-artifact',
      linehaulPdfDataUrl: null, linehaulPdfArtifactId: 'pdf-early',
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost.mock.calls[0][1]).toMatchObject({ linehaul_pdf_artifact_id: 'pdf-early' })
  })

  it('still completes loading with the scan when the PDF upload is rejected outright', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact.mockRejectedValueOnce(new MockApiError(413, 'too large'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', {
      linehaulPhotoDataUrl: 'data:image/jpeg;base64,AAAA', linehaulPhotoArtifactId: 'scan-artifact',
      linehaulPdfDataUrl: 'data:application/pdf;base64,JVBERi0=', linehaulPdfArtifactId: null,
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost.mock.calls[0][1]).toMatchObject({
      linehaul_photo_artifact_id: 'scan-artifact', linehaul_pdf_artifact_id: null,
    })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it.each([
    ['no response (status 0)', new MockApiError(0, 'timed out')],
    ['a server error (5xx)', new MockApiError(503, 'unavailable')],
    ['a network failure', new TypeError('Failed to fetch')],
  ])('rejects the loading when the PDF upload fails with %s, so the queue retries it whole', async (_case, error) => {
    mockUploadArtifact.mockRejectedValueOnce(error)

    const { submitPhase } = await import('../phases')

    await expect(submitPhase('trip-1', 'phase-event-2', 'loading', {
      linehaulPhotoDataUrl: 'data:image/jpeg;base64,AAAA', linehaulPhotoArtifactId: 'scan-artifact',
      linehaulPdfDataUrl: 'data:application/pdf;base64,JVBERi0=', linehaulPdfArtifactId: null,
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)).rejects.toBe(error)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('completes loading with no linehaul photo — the warehouse scan is what was recorded', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-2/complete',
      {
        phase_type: 'loading',
        driver_phone_lat: POSITION.lat,
        driver_phone_lng: POSITION.lng,
        driver_accuracy_metres: POSITION.accuracyM,
        linehaul_photo_artifact_id: null,
        linehaul_pdf_artifact_id: null,
        idempotency_key: IDEMPOTENCY_KEY,
        driver_captured_at: DRIVER_CAPTURED_AT,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('uploads only the seal photo and completes departure with the seal captured there — not loading', async () => {
    mockUploadArtifact.mockResolvedValueOnce({ id: 'seal-artifact', file_hash: 'b'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-3', 'departure', DEPARTURE_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(1)
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-3/complete',
      {
        phase_type: 'departure',
        driver_phone_lat: POSITION.lat,
        driver_phone_lng: POSITION.lng,
        driver_accuracy_metres: POSITION.accuracyM,
        waybill_photo_artifact_id: null,
        seal_number: 'AB-1234',
        seal_number_source: 'typed',
        seal_photo_artifact_id: 'seal-artifact',
        idempotency_key: IDEMPOTENCY_KEY,
        driver_captured_at: DRIVER_CAPTURED_AT,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('sends ocr_confirmed when the departure seal number is what OCR read', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact.mockResolvedValue({ id: 'seal-artifact' })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-3', 'departure', {
      sealNumber: 'AB-1234', sealNumberOcr: 'AB-1234',
      sealPhotoDataUrl: 'data:image/jpeg;base64,AAAA', sealPhotoArtifactId: 'seal-artifact',
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost.mock.calls[0][1]).toMatchObject({ seal_number_source: 'ocr_confirmed' })
  })

  it('sends typed for a departure draft saved before OCR existed', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-3', 'departure', {
      sealNumber: 'AB-1234',
      sealPhotoDataUrl: 'data:image/jpeg;base64,AAAA', sealPhotoArtifactId: 'seal-artifact',
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost.mock.calls[0][1]).toMatchObject({ seal_number_source: 'typed' })
  })

  it('sends no seal_number_source for a missing seal at arrival', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-5', 'arrival', {
      sealCondition: 'missing', sealNumberAtArrival: null, sealNumberAtArrivalOcr: null,
      sealPhotoDataUrl: 'data:image/jpeg;base64,AAAA', sealPhotoArtifactId: 'seal-artifact',
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost.mock.calls[0][1]).not.toHaveProperty('seal_number_source')
  })

  it('sends ocr_corrected when the arrival number differs from what OCR read', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-5', 'arrival', {
      sealCondition: 'intact', sealNumberAtArrival: 'AB-1234', sealNumberAtArrivalOcr: 'AB-1284',
      sealPhotoDataUrl: 'data:image/jpeg;base64,AAAA', sealPhotoArtifactId: 'seal-artifact',
      capturedAt: DRIVER_CAPTURED_AT,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost.mock.calls[0][1]).toMatchObject({ seal_number_source: 'ocr_corrected' })
  })

  it('throws instead of submitting when the departure evidence has no seal number', async () => {
    const { submitPhase } = await import('../phases')
    const incomplete: DepartureEvidence = { ...DEPARTURE_EVIDENCE, sealNumber: null }

    await expect(
      submitPhase('trip-1', 'phase-event-3', 'departure', incomplete, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT),
    ).rejects.toThrow(/Departure evidence incomplete/)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('completes unloading with base fields only — no seal, no upload', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-4', 'unloading', UNLOADING_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-4/complete',
      {
        phase_type: 'unloading',
        driver_phone_lat: POSITION.lat,
        driver_phone_lng: POSITION.lng,
        driver_accuracy_metres: POSITION.accuracyM,
        idempotency_key: IDEMPOTENCY_KEY,
        driver_captured_at: DRIVER_CAPTURED_AT,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('uploads only the POD photo and completes confirmation with the carried-forward visual count', async () => {
    mockUploadArtifact.mockResolvedValueOnce({ id: 'pod-photo-artifact', file_hash: 'a'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-5', 'confirmation', CONFIRMATION_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(1)
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-5/complete',
      {
        phase_type: 'confirmation',
        driver_phone_lat: POSITION.lat,
        driver_phone_lng: POSITION.lng,
        driver_accuracy_metres: POSITION.accuracyM,
        pod_photo_artifact_id: 'pod-photo-artifact',
        pod_signature_artifact_id: 'receiver-signature-artifact',
        driver_visual_count: 31,
        idempotency_key: IDEMPOTENCY_KEY,
        driver_captured_at: DRIVER_CAPTURED_AT,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('completes confirmation with a null visual count when the driver left unloading\'s count blank', async () => {
    mockUploadArtifact.mockResolvedValueOnce({ id: 'pod-photo-artifact', file_hash: 'a'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase(
      'trip-1', 'phase-event-5', 'confirmation',
      { ...CONFIRMATION_EVIDENCE, driverVisualCount: null }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT,
    )

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-5/complete',
      expect.objectContaining({ driver_visual_count: null }),
      { timeoutMs: 30_000 },
    )
  })

  it('coalesces a stale queued confirmation whose visual count field is absent entirely to null', async () => {
    mockUploadArtifact.mockResolvedValueOnce({ id: 'pod-photo-artifact', file_hash: 'a'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    const staleEntry = { ...CONFIRMATION_EVIDENCE }
    delete (staleEntry as Partial<ConfirmationEvidence>).driverVisualCount

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-5', 'confirmation', staleEntry, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-5/complete',
      expect.objectContaining({ driver_visual_count: null }),
      { timeoutMs: 30_000 },
    )
  })

  it('never sends receiver identity to the backend', async () => {
    mockUploadArtifact.mockResolvedValueOnce({ id: 'pod-photo-artifact', file_hash: 'a'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-5', 'confirmation', CONFIRMATION_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    const body = JSON.stringify(mockPost.mock.calls[0][1])
    expect(body).not.toMatch(/recipient/i)
    expect(body).not.toMatch(/id_number/i)
  })

  it('refuses to submit activation without a position instead of calling the backend', async () => {
    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-1', 'activation', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY, null, DRIVER_CAPTURED_AT),
    ).rejects.toThrow(/Could not get your location/)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('propagates a backend rejection from the artifact upload', async () => {
    mockUploadArtifact.mockRejectedValue(new Error('upload failed: HTTP 500'))

    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-3', 'departure', DEPARTURE_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT),
    ).rejects.toThrow(/upload failed/)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('rejects trip_creation — it is never completed by a driver action', async () => {
    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-0', 'trip_creation', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT),
    ).rejects.toThrow(/never completed by a driver action/)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('sends the exact idempotency_key it was given, unchanged from the caller', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, 'retry-key-123', POSITION, DRIVER_CAPTURED_AT)
    await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, 'retry-key-123', POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost).toHaveBeenCalledTimes(2)
    const [firstCallBody] = mockPost.mock.calls[0].slice(1)
    const [secondCallBody] = mockPost.mock.calls[1].slice(1)
    expect((firstCallBody as { idempotency_key: string }).idempotency_key).toBe('retry-key-123')
    expect((secondCallBody as { idempotency_key: string }).idempotency_key).toBe('retry-key-123')
  })

  it('surfaces the addressed phase\'s own status from the response instead of assuming a fresh completion', async () => {
    mockPost.mockResolvedValue({
      id: 'trip-1',
      phases: [
        { phase_event_id: 'phase-event-2', status: 'completed' },
        { phase_event_id: 'other-phase', status: 'pending' },
      ],
    })

    const { submitPhase } = await import('../phases')
    const result = await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(result.ok).toBe(true)
    expect(result.phaseStatus).toBe('completed')
  })

  it('surfaces an exception status the same way, rather than reporting it as a plain success', async () => {
    mockUploadArtifact.mockResolvedValue({ id: 'seal-intact-artifact', file_hash: 'c'.repeat(64) })
    mockPost.mockResolvedValue({
      id: 'trip-1',
      phases: [{ phase_event_id: 'phase-event-4', status: 'exception' }],
    })

    const { submitPhase } = await import('../phases')
    const result = await submitPhase('trip-1', 'phase-event-4', 'unloading', UNLOADING_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(result.ok).toBe(true)
    expect(result.phaseStatus).toBe('exception')
  })
})

describe('submitPhase — photos uploaded at capture', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends the artifact id the early upload already produced, without re-uploading', async () => {
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    await submitPhase('trip-1', 'phase-event-3', 'departure', {
      ...DEPARTURE_EVIDENCE,
      sealPhotoArtifactId: 'artifact-seal',
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-3/complete',
      expect.objectContaining({
        waybill_photo_artifact_id: null,
        seal_photo_artifact_id: 'artifact-seal',
      }),
      expect.anything(),
    )
  })

  it('uploads at submit for a photo whose early upload never landed', async () => {
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact.mockResolvedValueOnce({ id: 'late-seal', file_hash: 'h2' })

    await submitPhase('trip-1', 'phase-event-3', 'departure', {
      ...DEPARTURE_EVIDENCE,
      sealPhotoArtifactId: null,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(1)
    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        waybill_photo_artifact_id: null,
        seal_photo_artifact_id: 'late-seal',
      }),
      expect.anything(),
    )
  })

  it('still forwards the waybill photo of a departure queued before the step was removed', async () => {
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'legacy-waybill', file_hash: 'h1' })
      .mockResolvedValueOnce({ id: 'late-seal', file_hash: 'h2' })

    await submitPhase(
      'trip-1', 'phase-event-3', 'departure',
      LEGACY_QUEUED_DEPARTURE_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT,
    )

    expect(mockUploadArtifact).toHaveBeenCalledTimes(2)
    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        waybill_photo_artifact_id: 'legacy-waybill',
        seal_photo_artifact_id: 'late-seal',
      }),
      expect.anything(),
    )
  })

  it('reuses a legacy queued waybill artifact id without re-uploading it', async () => {
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const replayed = {
      ...LEGACY_QUEUED_DEPARTURE_EVIDENCE,
      waybillPhotoArtifactId: 'artifact-waybill',
      sealPhotoArtifactId: 'artifact-seal',
    }
    await submitPhase('trip-1', 'phase-event-3', 'departure', replayed, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        waybill_photo_artifact_id: 'artifact-waybill',
        seal_photo_artifact_id: 'artifact-seal',
      }),
      expect.anything(),
    )
  })

  it('sends the linehaul photo id the early upload already produced, without re-uploading', async () => {
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    await submitPhase('trip-1', 'phase-event-2', 'loading', {
      ...LOADING_EVIDENCE,
      linehaulPhotoDataUrl: 'data:image/jpeg;base64,GGGG',
      linehaulPhotoArtifactId: 'artifact-linehaul',
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ linehaul_photo_artifact_id: 'artifact-linehaul' }),
      expect.anything(),
    )
  })

  it('uploads the linehaul photo at submit when its early upload never landed', async () => {
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact.mockResolvedValueOnce({ id: 'late-linehaul', file_hash: 'h3' })

    await submitPhase('trip-1', 'phase-event-2', 'loading', {
      ...LOADING_EVIDENCE,
      linehaulPhotoDataUrl: 'data:image/jpeg;base64,GGGG',
      linehaulPhotoArtifactId: null,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(1)
    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ linehaul_photo_artifact_id: 'late-linehaul' }),
      expect.anything(),
    )
  })
})

describe('submitPhase — attribution', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fallback upload carries the phase and role', async () => {
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact.mockResolvedValue({ id: 'late-artifact', file_hash: 'h' })

    await submitPhase('trip-1', 'phase-loading', 'loading', {
      ...LOADING_EVIDENCE,
      linehaulPhotoDataUrl: 'data:image/jpeg;base64,GGGG',
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)
    await submitPhase('trip-1', 'phase-departure', 'departure', DEPARTURE_EVIDENCE,
      IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)
    await submitPhase('trip-1', 'phase-arrival', 'arrival', ARRIVAL_EVIDENCE,
      IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)
    await submitPhase('trip-1', 'phase-confirmation', 'confirmation', CONFIRMATION_EVIDENCE,
      IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    const attributions = mockUploadArtifact.mock.calls.map(
      ([params]) => (params as { attribution: unknown }).attribution,
    )
    expect(attributions).toEqual([
      { phaseEventId: 'phase-loading', role: 'linehaul_photo' },
      { phaseEventId: 'phase-departure', role: 'seal_photo' },
      { phaseEventId: 'phase-arrival', role: 'seal_photo' },
      { phaseEventId: 'phase-confirmation', role: 'pod_photo' },
    ])
  })

  it('ready id skips the upload', async () => {
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    await submitPhase('trip-1', 'phase-confirmation', 'confirmation', {
      ...CONFIRMATION_EVIDENCE,
      podPhotoArtifactId: 'ready-pod-photo',
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        pod_photo_artifact_id: 'ready-pod-photo',
        pod_signature_artifact_id: 'receiver-signature-artifact',
      }),
      expect.anything(),
    )
  })

  it('queued replay uploads with attribution', async () => {
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'legacy-waybill', file_hash: 'h1' })
      .mockResolvedValueOnce({ id: 'late-seal', file_hash: 'h2' })

    await submitPhase(
      'trip-1', 'queued-phase', 'departure',
      LEGACY_QUEUED_DEPARTURE_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT,
    )

    expect(mockUploadArtifact).toHaveBeenCalledWith(expect.objectContaining({
      attribution: { phaseEventId: 'queued-phase', role: 'waybill_photo' },
    }))
    expect(mockUploadArtifact).toHaveBeenCalledWith(expect.objectContaining({
      attribution: { phaseEventId: 'queued-phase', role: 'seal_photo' },
    }))
  })
})

describe('submitPhase — in_transit (arrival attestation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('posts the arrival attestation with the fix and nothing else', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    const arrivalPosition: DriverPosition = { lat: -29.8587, lng: 31.0218, accuracyM: 8 }

    const { submitPhase } = await import('../phases')
    await submitPhase(
      'trip-1', 'phase-in-transit-1', 'in_transit',
      { capturedAt: '2026-08-09T10:00:00.000Z' }, 'idem-arrival-1', arrivalPosition, DRIVER_CAPTURED_AT,
    )

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-in-transit-1/complete',
      {
        phase_type: 'in_transit',
        driver_phone_lat: -29.8587,
        driver_phone_lng: 31.0218,
        driver_accuracy_metres: 8,
        idempotency_key: 'idem-arrival-1',
        driver_captured_at: DRIVER_CAPTURED_AT,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('omits the position keys entirely when there is no fix', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase(
      'trip-1', 'phase-in-transit-1', 'in_transit',
      { capturedAt: '2026-08-09T10:00:00.000Z' }, 'idem-arrival-1', null, DRIVER_CAPTURED_AT,
    )

    const [, body] = mockPost.mock.calls[0]
    expect(body).not.toHaveProperty('driver_phone_lat')
    expect(body).not.toHaveProperty('driver_phone_lng')
  })

  it('uploads no artifact', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase(
      'trip-1', 'phase-in-transit-1', 'in_transit',
      { capturedAt: '2026-08-09T10:00:00.000Z' }, 'idem-arrival-1', { lat: -29.8587, lng: 31.0218, accuracyM: 8 }, DRIVER_CAPTURED_AT,
    )

    expect(mockUploadArtifact).not.toHaveBeenCalled()
  })
})

describe('submitPhase — arrival', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uploads the seal photo and completes arrival with the seal as found for server-side comparison', async () => {
    mockUploadArtifact.mockResolvedValueOnce({ id: 'seal-arrival-artifact', file_hash: 'c'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-arrival-1', 'arrival', ARRIVAL_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-arrival-1/complete',
      {
        phase_type: 'arrival',
        driver_phone_lat: POSITION.lat,
        driver_phone_lng: POSITION.lng,
        driver_accuracy_metres: POSITION.accuracyM,
        seal_condition: 'intact',
        seal_number_at_arrival: 'AB-1234',
        seal_number_source: 'typed',
        seal_photo_artifact_id: 'seal-arrival-artifact',
        idempotency_key: IDEMPOTENCY_KEY,
        driver_captured_at: DRIVER_CAPTURED_AT,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('sends the seal artifact id from the early upload without re-uploading', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-arrival-1', 'arrival', {
      ...ARRIVAL_EVIDENCE,
      sealPhotoArtifactId: 'artifact-seal-arrival',
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-arrival-1/complete',
      expect.objectContaining({ seal_photo_artifact_id: 'artifact-seal-arrival' }),
      { timeoutMs: 30_000 },
    )
  })

  it('omits seal_number_at_arrival entirely when the seal is missing', async () => {
    mockUploadArtifact.mockResolvedValueOnce({ id: 'seal-arrival-artifact', file_hash: 'c'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-arrival-1', 'arrival', {
      ...ARRIVAL_EVIDENCE, sealCondition: 'missing', sealNumberAtArrival: null,
    }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)

    const [, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>]
    expect(body).not.toHaveProperty('seal_number_at_arrival')
    expect(body.seal_condition).toBe('missing')
  })

  it('still requires the photo when the seal is missing', async () => {
    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-arrival-1', 'arrival', {
        ...ARRIVAL_EVIDENCE, sealCondition: 'missing', sealNumberAtArrival: null,
        sealPhotoDataUrl: null, sealPhotoArtifactId: null,
      }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT),
    ).rejects.toThrow(/Arrival evidence incomplete/)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('rejects a damaged/intact seal with no number before calling the backend', async () => {
    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-arrival-1', 'arrival', {
        ...ARRIVAL_EVIDENCE, sealNumberAtArrival: null,
      }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT),
    ).rejects.toThrow(/Arrival evidence incomplete/)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('rejects arrival with no seal photo before calling the backend', async () => {
    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-arrival-1', 'arrival', {
        ...ARRIVAL_EVIDENCE, sealPhotoDataUrl: null, sealPhotoArtifactId: null,
      }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT),
    ).rejects.toThrow(/Arrival evidence incomplete/)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('rejects arrival with no seal condition chosen before calling the backend', async () => {
    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-arrival-1', 'arrival', {
        ...ARRIVAL_EVIDENCE, sealCondition: null,
      }, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT),
    ).rejects.toThrow(/Arrival evidence incomplete/)
    expect(mockPost).not.toHaveBeenCalled()
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
    const promise = submitPhase('trip-1', 'phase-event-1', 'activation', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY, POSITION, DRIVER_CAPTURED_AT)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(result).toEqual({ ok: true, trip: null, phaseStatus: 'completed' })
    expect(demoMockPost).not.toHaveBeenCalled()
  })
})

it('stops_after_account_generation_changes_between_upload_and_completion', async () => {
  vi.resetModules()
  vi.doMock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))
  vi.doMock('@/lib/api/artifacts', () => ({ uploadArtifact: (...args: unknown[]) => mockUploadArtifact(...args) }))
  vi.doMock('@/lib/api/client', () => ({ api: { post: (...args: unknown[]) => mockPost(...args) } }))
  const actor = await import('@/lib/session/custody-context')
  actor.bindActorLease('driver-a', actor.invalidateActorLease())
  let release!: (value: { id: string }) => void
  mockUploadArtifact.mockReset().mockImplementationOnce(() => new Promise((resolve) => { release = resolve }))
  mockPost.mockClear()
  const { submitPhase } = await import('../phases')
  const result = submitPhase('trip', 'phase', 'loading', { ...LOADING_EVIDENCE, linehaulPhotoDataUrl: 'bytes', linehaulPdfDataUrl: 'pdf-bytes' }, 'key', null, DRIVER_CAPTURED_AT).catch((error: unknown) => error)
  await vi.waitFor(() => expect(mockUploadArtifact).toHaveBeenCalledTimes(1))
  actor.bindActorLease('driver-b', actor.invalidateActorLease())
  actor.bindActorLease('driver-a', actor.invalidateActorLease())
  release({ id: 'saved-first' })
  await result
  expect(mockUploadArtifact).toHaveBeenCalledTimes(1)
  expect(mockPost).not.toHaveBeenCalled()
  actor.invalidateActorLease()
})
