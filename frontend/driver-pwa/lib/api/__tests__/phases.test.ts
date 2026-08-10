// frontend/driver-pwa/lib/api/__tests__/phases.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { DriverPosition } from '@/lib/types/location'
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
  capturedAt: '2026-06-12T10:00:00Z',
}

// The driver's fix, captured silently at submit time and passed in alongside the
// evidence — it is no longer part of any draft (see lib/types/location.ts).
const POSITION: DriverPosition = { lat: -26.09, lng: 28.13, accuracyM: 8 }

// loading captures only one thing itself (Task 13, 2026-08-05): a photo of the paper
// linehaul sheet, optional on the wire. The warehouse scan is what records what was
// loaded — the driver's step is otherwise a read-only linehaul review. No photo here is
// the base case; the "photos uploaded at capture" block below covers the captured one.
const LOADING_EVIDENCE: LoadingEvidence = {
  linehaulPhotoDataUrl: null,
  linehaulPhotoArtifactId: null,
  capturedAt: '2026-06-12T10:05:00Z',
}

const DEPARTURE_EVIDENCE: DepartureEvidence = {
  // No artifact ids: this fixture is the "early upload never landed" case, which is what
  // exercises submitPhase's upload-at-submit fallback. The ready-id path has its own test.
  sealPhotoArtifactId: null,
  sealNumber: 'AB-1234',
  sealPhotoDataUrl: 'data:image/jpeg;base64,CCCC',
  capturedAt: '2026-06-12T10:10:00Z',
}

// A departure draft as an offline-queue entry persisted BEFORE '3-waybill' was removed
// (2026-08-10) still looks: the two waybill properties are absent from DepartureEvidence
// now, so the fixture is built as an intersection rather than by widening the live type.
const LEGACY_QUEUED_DEPARTURE_EVIDENCE = {
  ...DEPARTURE_EVIDENCE,
  waybillPhotoDataUrl: 'data:image/jpeg;base64,BBBB',
  waybillPhotoArtifactId: null,
} satisfies DepartureEvidence & { waybillPhotoDataUrl: string; waybillPhotoArtifactId: string | null }

const UNLOADING_EVIDENCE: UnloadingEvidence = {
  waybillHandedOver: true,
  sealNumberAtDestination: 'AB-1234',
  sealIntactPhotoDataUrl: 'data:image/jpeg;base64,CCCC',
  sealIntactPhotoArtifactId: null,
  driverVisualCount: 31,
  capturedAt: '2026-06-12T10:20:00Z',
}

const CONFIRMATION_EVIDENCE: ConfirmationEvidence = {
  podPhotoArtifactId: null,
  podSignatureArtifactId: null,
  podPhotoDataUrl: 'data:image/jpeg;base64,EEEE',
  podSignatureDataUrl: 'data:image/png;base64,FFFF',
  // Present in the DRAFT but deliberately absent from the wire — see the POPIA test below.
  recipientName: 'Nomsa Dlamini',
  recipientIdNumber: '9202204720082',
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
    const result = await submitPhase('trip-1', 'phase-event-1', 'activation', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY, POSITION)

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

  it('completes loading with no linehaul photo — the warehouse scan is what was recorded', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, IDEMPOTENCY_KEY, POSITION)

    // No data URL was captured, so no upload is attempted and the id is sent as an
    // explicit null — never omitted (see the field's comment on LoadingCompleteRequest).
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-2/complete',
      {
        phase_type: 'loading',
        // Every phase carries the silently-captured fix now, not just activation.
        driver_phone_lat: POSITION.lat,
        driver_phone_lng: POSITION.lng,
        linehaul_photo_artifact_id: null,
        idempotency_key: IDEMPOTENCY_KEY,
      },
      { timeoutMs: 30_000 },
    )
  })

  // Parent plan's flagged 🔴 risk: the seal moved from `loading` to `departure` (D7/T5).
  // A stale field or a silently-null seal here would let a NULL == NULL comparison
  // pass server-side without raising anything and without failing any test — this
  // proves the seal captured IN the departure draft is exactly what departure submits.
  it('uploads only the seal photo and completes departure with the seal captured there — not loading', async () => {
    mockUploadArtifact.mockResolvedValueOnce({ id: 'seal-artifact', file_hash: 'b'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-3', 'departure', DEPARTURE_EVIDENCE, IDEMPOTENCY_KEY, POSITION)

    // ONE upload, not two: the waybill photo is no longer captured at departure
    // ('3-waybill' removed 2026-08-10 — it duplicated loading's linehaul sheet). A second
    // upload here would mean the duplicate capture had crept back in.
    expect(mockUploadArtifact).toHaveBeenCalledTimes(1)
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-3/complete',
      {
        phase_type: 'departure',
        // Every phase carries the silently-captured fix now, not just activation.
        driver_phone_lat: POSITION.lat,
        driver_phone_lng: POSITION.lng,
        // Explicitly null, not omitted — mirrors loading's linehaul id and keeps the
        // wire shape stable for the backend's still-Optional field.
        waybill_photo_artifact_id: null,
        seal_number: 'AB-1234',
        seal_photo_artifact_id: 'seal-artifact',
        // No guard_verified_seal and no seal_number_confirmed. toHaveBeenCalledWith is an
        // EXACT object match, so this assertion also fences the removal: sending either
        // key again fails here. That matters more than a tidier payload — the backend
        // treats a `false` guard_verified_seal as a CRITICAL seal_mismatch, so a
        // regression that reinstated the field with a falsy default would flag every trip.
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
      submitPhase('trip-1', 'phase-event-3', 'departure', incomplete, IDEMPOTENCY_KEY, POSITION),
    ).rejects.toThrow(/Departure evidence incomplete/)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('uploads the intact seal photo and completes unloading with the confirmed seal for server-side comparison', async () => {
    mockUploadArtifact.mockResolvedValueOnce({ id: 'seal-intact-artifact', file_hash: 'c'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-4', 'unloading', UNLOADING_EVIDENCE, IDEMPOTENCY_KEY, POSITION)

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-4/complete',
      {
        phase_type: 'unloading',
        // Every phase carries the silently-captured fix now, not just activation.
        driver_phone_lat: POSITION.lat,
        driver_phone_lng: POSITION.lng,
        seal_number_at_destination: 'AB-1234',
        // Required by UnloadingCompleteRequest — the seal as found, intact.
        gate_photo_artifact_id: 'seal-intact-artifact',
        idempotency_key: IDEMPOTENCY_KEY,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('sends the intact seal artifact id from the early upload without re-uploading', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-4', 'unloading', {
      ...UNLOADING_EVIDENCE,
      sealIntactPhotoArtifactId: 'artifact-seal-intact',
    }, IDEMPOTENCY_KEY, POSITION)

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-4/complete',
      expect.objectContaining({ gate_photo_artifact_id: 'artifact-seal-intact' }),
      { timeoutMs: 30_000 },
    )
  })

  // The photo cannot be retaken once the seal is broken, so submitting without it must
  // fail loudly on the client rather than reaching the backend and 422-ing.
  it('rejects unloading with no intact seal photo before calling the backend', async () => {
    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-4', 'unloading', {
        ...UNLOADING_EVIDENCE, sealIntactPhotoDataUrl: null, sealIntactPhotoArtifactId: null,
      }, IDEMPOTENCY_KEY, POSITION),
    ).rejects.toThrow(/Unloading evidence incomplete/)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  // An unloading queued offline before the intact-photo field existed replays from
  // localStorage with the property missing altogether, not set to null. It must fail the
  // same way rather than posting `gate_photo_artifact_id: undefined` for the backend to
  // 422 — the driver keeps a queue entry that can never drain and no idea why.
  it('rejects a stale queued unloading whose intact photo field is absent entirely', async () => {
    const { submitPhase } = await import('../phases')
    const staleEntry = { ...UNLOADING_EVIDENCE }
    delete (staleEntry as Partial<UnloadingEvidence>).sealIntactPhotoDataUrl
    delete (staleEntry as Partial<UnloadingEvidence>).sealIntactPhotoArtifactId

    await expect(
      submitPhase('trip-1', 'phase-event-4', 'unloading', staleEntry, IDEMPOTENCY_KEY, POSITION),
    ).rejects.toThrow(/Unloading evidence incomplete/)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('uploads POD photo and signature then completes confirmation with the carried-forward visual count', async () => {
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'pod-photo-artifact', file_hash: 'a'.repeat(64) })
      .mockResolvedValueOnce({ id: 'pod-signature-artifact', file_hash: 'b'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-5', 'confirmation', CONFIRMATION_EVIDENCE, IDEMPOTENCY_KEY, POSITION)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(2)
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-5/complete',
      {
        phase_type: 'confirmation',
        // Every phase carries the silently-captured fix now, not just activation.
        driver_phone_lat: POSITION.lat,
        driver_phone_lng: POSITION.lng,
        pod_photo_artifact_id: 'pod-photo-artifact',
        pod_signature_artifact_id: 'pod-signature-artifact',
        driver_visual_count: 31,
        // No pp_scan_in_count — toHaveBeenCalledWith is an EXACT object match, so this
        // assertion also fences its removal: the field carried the driver's own count a
        // second time under a different key, which made the server compare a number
        // against itself. The backend derives it from Parcel.pp_scan_in_at instead
        // (schemas/phases.py's ConfirmationCompleteRequest comment).
        idempotency_key: IDEMPOTENCY_KEY,
      },
      { timeoutMs: 30_000 },
    )
  })

  // 2026-08-08: the visual count became optional at unloading, so a legitimately empty
  // carry-forward must reach confirmation's completion as an explicit null — not block
  // the swipe, not throw, not silently become 0.
  it('completes confirmation with a null visual count when the driver left unloading\'s count blank', async () => {
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'pod-photo-artifact', file_hash: 'a'.repeat(64) })
      .mockResolvedValueOnce({ id: 'pod-signature-artifact', file_hash: 'b'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase(
      'trip-1', 'phase-event-5', 'confirmation',
      { ...CONFIRMATION_EVIDENCE, driverVisualCount: null }, IDEMPOTENCY_KEY, POSITION,
    )

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-5/complete',
      expect.objectContaining({ driver_visual_count: null }),
      { timeoutMs: 30_000 },
    )
  })

  // A confirmation draft queued offline before driverVisualCount could legitimately be
  // blank replays from localStorage with the key absent entirely, not set to null —
  // unlike unloading's required fields, this must still submit (coalesced to null), not
  // reject the whole completion over an optional field.
  it('coalesces a stale queued confirmation whose visual count field is absent entirely to null', async () => {
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'pod-photo-artifact', file_hash: 'a'.repeat(64) })
      .mockResolvedValueOnce({ id: 'pod-signature-artifact', file_hash: 'b'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    const staleEntry = { ...CONFIRMATION_EVIDENCE }
    delete (staleEntry as Partial<ConfirmationEvidence>).driverVisualCount

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-5', 'confirmation', staleEntry, IDEMPOTENCY_KEY, POSITION)

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-event-5/complete',
      expect.objectContaining({ driver_visual_count: null }),
      { timeoutMs: 30_000 },
    )
  })

  // POPIA tripwire. The receiver's name and ID number are personal data. They reach
  // Supabase Storage (af-south-1) INSIDE the attestation PNG and must go nowhere else:
  // not onto a phase row, not into a canonical payload, and so never near Hedera. The
  // exact-object assertion above already enforces this, but it enforces it silently —
  // this test states the reason, so a future contributor adding the fields to the wire
  // gets a failure that explains itself.
  it('never sends the receiver name or ID number to the backend', async () => {
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'pod-photo-artifact', file_hash: 'a'.repeat(64) })
      .mockResolvedValueOnce({ id: 'pod-signature-artifact', file_hash: 'b'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-5', 'confirmation', CONFIRMATION_EVIDENCE, IDEMPOTENCY_KEY, POSITION)

    const body = JSON.stringify(mockPost.mock.calls[0][1])
    expect(body).not.toContain(CONFIRMATION_EVIDENCE.recipientName)
    expect(body).not.toContain(CONFIRMATION_EVIDENCE.recipientIdNumber)
    expect(body).not.toMatch(/recipient/i)
  })

  it('refuses to submit activation without a position instead of calling the backend', async () => {
    // Activation is the one phase the backend requires coordinates for — it records
    // WHERE the trip started. Every other phase submits happily without a fix.
    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-1', 'activation', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY, null),
    ).rejects.toThrow(/Could not get your location/)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('propagates a backend rejection from the artifact upload', async () => {
    mockUploadArtifact.mockRejectedValue(new Error('upload failed: HTTP 500'))

    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-3', 'departure', DEPARTURE_EVIDENCE, IDEMPOTENCY_KEY, POSITION),
    ).rejects.toThrow(/upload failed/)
    expect(mockPost).not.toHaveBeenCalled()
  })

  // in_transit JOINED the completable set on 2026-08-09 (arrival attestation) and is
  // covered by its own describe block below — only trip_creation is still unreachable
  // by a driver action.
  it('rejects trip_creation — it is never completed by a driver action', async () => {
    const { submitPhase } = await import('../phases')

    await expect(
      submitPhase('trip-1', 'phase-event-0', 'trip_creation', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY, POSITION),
    ).rejects.toThrow(/never completed by a driver action/)
    expect(mockPost).not.toHaveBeenCalled()
  })

  // Task 5.3: the idempotency key is caller-supplied and must be sent verbatim,
  // unchanged across a caller-driven retry of the same logical submission.
  it('sends the exact idempotency_key it was given, unchanged from the caller', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, 'retry-key-123', POSITION)
    await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, 'retry-key-123', POSITION)

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
    const result = await submitPhase('trip-1', 'phase-event-2', 'loading', LOADING_EVIDENCE, IDEMPOTENCY_KEY, POSITION)

    expect(result.ok).toBe(true)
    expect(result.phaseStatus).toBe('completed')
  })

  it('surfaces an exception status the same way, rather than reporting it as a plain success', async () => {
    // Stubbed explicitly because unloading now uploads its intact seal photo, and the
    // beforeEach only clears mock CALLS, not implementations — without this, an earlier
    // test's mockRejectedValue would still be in force here.
    mockUploadArtifact.mockResolvedValue({ id: 'seal-intact-artifact', file_hash: 'c'.repeat(64) })
    mockPost.mockResolvedValue({
      id: 'trip-1',
      phases: [{ phase_event_id: 'phase-event-4', status: 'exception' }],
    })

    const { submitPhase } = await import('../phases')
    const result = await submitPhase('trip-1', 'phase-event-4', 'unloading', UNLOADING_EVIDENCE, IDEMPOTENCY_KEY, POSITION)

    expect(result.ok).toBe(true)
    expect(result.phaseStatus).toBe('exception')
  })
})

describe('submitPhase — photos uploaded at capture', () => {
  // Call counts are the assertion in this block, so each test starts from zero.
  beforeEach(() => vi.clearAllMocks())

  it('sends the artifact id the early upload already produced, without re-uploading', async () => {
    // The whole point of uploading at capture: by the time the driver swipes, the photo
    // is already on the server and the submit is one small request.
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    await submitPhase('trip-1', 'phase-event-3', 'departure', {
      ...DEPARTURE_EVIDENCE,
      sealPhotoArtifactId: 'artifact-seal',
    }, IDEMPOTENCY_KEY, POSITION)

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
    // Captured offline, or the early request failed. The data URL is still in the draft,
    // so the submit path uploads it exactly as it did before — nothing is lost, it is
    // just slower.
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact.mockResolvedValueOnce({ id: 'late-seal', file_hash: 'h2' })

    await submitPhase('trip-1', 'phase-event-3', 'departure', {
      ...DEPARTURE_EVIDENCE,
      sealPhotoArtifactId: null,
    }, IDEMPOTENCY_KEY, POSITION)

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

  // Removing '3-waybill' must not silently bin a photo a driver already took. An entry
  // queued offline under the old build replays with the waybill fields still on its
  // stored draft, and the backend still accepts the id (Optional) — so it is forwarded,
  // uploaded at submit if its early upload never landed, exactly like any other photo.
  it('still forwards the waybill photo of a departure queued before the step was removed', async () => {
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'legacy-waybill', file_hash: 'h1' })
      .mockResolvedValueOnce({ id: 'late-seal', file_hash: 'h2' })

    await submitPhase(
      'trip-1', 'phase-event-3', 'departure',
      LEGACY_QUEUED_DEPARTURE_EVIDENCE, IDEMPOTENCY_KEY, POSITION,
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

  // The same replayed entry whose early upload DID land: no re-upload of the legacy
  // photo, the stored id goes straight to the wire.
  it('reuses a legacy queued waybill artifact id without re-uploading it', async () => {
    const { submitPhase } = await import('../phases')
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    // Bound to a const rather than passed as a literal: the legacy waybill properties are
    // deliberately absent from DepartureEvidence, so a fresh literal at the call site
    // would trip TS's excess-property check on submitPhase's PhaseEvidence parameter —
    // which is exactly the type-level guarantee that no live code writes them any more.
    const replayed = {
      ...LEGACY_QUEUED_DEPARTURE_EVIDENCE,
      waybillPhotoArtifactId: 'artifact-waybill',
      sealPhotoArtifactId: 'artifact-seal',
    }
    await submitPhase('trip-1', 'phase-event-3', 'departure', replayed, IDEMPOTENCY_KEY, POSITION)

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
    }, IDEMPOTENCY_KEY, POSITION)

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
    }, IDEMPOTENCY_KEY, POSITION)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(1)
    expect(mockPost).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ linehaul_photo_artifact_id: 'late-linehaul' }),
      expect.anything(),
    )
  })
})

describe('submitPhase — in_transit (arrival attestation)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Arrival carries no evidence of its own (see InTransitEvidence's comment) — the fix
  // and the idempotency key are the entire wire body, with no photo/artifact key at all.
  it('posts the arrival attestation with the fix and nothing else', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })
    const arrivalPosition: DriverPosition = { lat: -29.8587, lng: 31.0218, accuracyM: 8 }

    const { submitPhase } = await import('../phases')
    await submitPhase(
      'trip-1', 'phase-in-transit-1', 'in_transit',
      { capturedAt: '2026-08-09T10:00:00.000Z' }, 'idem-arrival-1', arrivalPosition,
    )

    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/phases/phase-in-transit-1/complete',
      {
        phase_type: 'in_transit',
        driver_phone_lat: -29.8587,
        driver_phone_lng: 31.0218,
        idempotency_key: 'idem-arrival-1',
      },
      { timeoutMs: 30_000 },
    )
  })

  // A failed capture must not overwrite a position an earlier attempt already stored —
  // driverPosition() omits the keys rather than sending null (see its own comment).
  it('omits the position keys entirely when there is no fix', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase(
      'trip-1', 'phase-in-transit-1', 'in_transit',
      { capturedAt: '2026-08-09T10:00:00.000Z' }, 'idem-arrival-1', null,
    )

    const [, body] = mockPost.mock.calls[0]
    expect(body).not.toHaveProperty('driver_phone_lat')
    expect(body).not.toHaveProperty('driver_phone_lng')
  })

  // Arrival is an attestation, not an evidence capture — there is no photo to upload.
  it('uploads no artifact', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', phases: [] })

    const { submitPhase } = await import('../phases')
    await submitPhase(
      'trip-1', 'phase-in-transit-1', 'in_transit',
      { capturedAt: '2026-08-09T10:00:00.000Z' }, 'idem-arrival-1', { lat: -29.8587, lng: 31.0218, accuracyM: 8 },
    )

    expect(mockUploadArtifact).not.toHaveBeenCalled()
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
    const promise = submitPhase('trip-1', 'phase-event-1', 'activation', ACTIVATION_EVIDENCE, IDEMPOTENCY_KEY, POSITION)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(result).toEqual({ ok: true, trip: null, phaseStatus: 'completed' })
    expect(demoMockPost).not.toHaveBeenCalled()
  })
})
