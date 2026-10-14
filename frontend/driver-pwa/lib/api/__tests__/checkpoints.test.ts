// frontend/driver-pwa/lib/api/__tests__/checkpoints.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { CheckpointEvidence } from '../checkpoints'

const EVIDENCE: CheckpointEvidence = {
  gpsLat: -29.85, gpsLng: 31.02,
  selfieDataUrl: 'data:image/jpeg;base64,AAAA',
  cargoPhotoDataUrl: 'data:image/jpeg;base64,BBBB',
  note: 'All good.', isDeviation: false,
  capturedAt: '2026-06-12T10:00:00Z',
  clientReportId: 'd0a29a8e-94d3-4a16-879d-46fbf6619999',
  phaseEventId: '5f20a790-4fd3-4d40-9b9e-d7d3b7903249',
}

describe('submitCheckpoint (Fix 4: demo-mode gate)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('short-circuits with a fake result in demo mode instead of hitting the network', async () => {
    vi.doMock('@/lib/constants/env', () => ({ IS_DEMO_MODE: true }))
    const mockPost = vi.fn()
    vi.doMock('@/lib/api/client', () => ({
      api: { get: vi.fn(), post: (...args: unknown[]) => mockPost(...args), postForm: vi.fn() },
    }))
    const mockUploadArtifact = vi.fn()
    vi.doMock('@/lib/api/artifacts', () => ({
      uploadArtifact: (...args: unknown[]) => mockUploadArtifact(...args),
    }))

    const { submitCheckpoint } = await import('../checkpoints')
    const promise = submitCheckpoint('trip-1', EVIDENCE)
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(result.trip_id).toBe('trip-1')
    expect(result.driver_phone_lat).toBe(EVIDENCE.gpsLat)
    expect(result.driver_phone_lng).toBe(EVIDENCE.gpsLng)
    expect(result.is_deviation).toBe(false)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('uploads both photos then posts the checkpoint in the real-backend branch', async () => {
    vi.doMock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))
    const mockPost = vi.fn().mockResolvedValue({ id: 'cp-1' })
    vi.doMock('@/lib/api/client', () => ({
      api: { get: vi.fn(), post: (...args: unknown[]) => mockPost(...args), postForm: vi.fn() },
    }))
    const mockUploadArtifact = vi.fn()
      .mockResolvedValueOnce({ id: 'cargo-artifact', file_hash: 'b'.repeat(64) })
      .mockResolvedValueOnce({ id: 'selfie-artifact', file_hash: 'a'.repeat(64) })
    vi.doMock('@/lib/api/artifacts', () => ({
      uploadArtifact: (...args: unknown[]) => mockUploadArtifact(...args),
    }))

    const { submitCheckpoint } = await import('../checkpoints')
    const result = await submitCheckpoint('trip-1', EVIDENCE)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(2)
    expect(mockPost).toHaveBeenCalledWith('/api/v1/trips/trip-1/checkpoints', {
      checkpoint_type: 'manual',
      driver_phone_lat: EVIDENCE.gpsLat,
      driver_phone_lng: EVIDENCE.gpsLng,
      driver_captured_at: EVIDENCE.capturedAt,
      client_report_id: EVIDENCE.clientReportId,
      phase_event_id: EVIDENCE.phaseEventId,
      selfie_artifact_id: 'selfie-artifact',
      cargo_photo_artifact_id: 'cargo-artifact',
      note: 'All good.',
      is_deviation: false,
    })
    expect(result).toEqual({ id: 'cp-1' })
  })

  it('test_uploads_only_the_cargo_photo_and_sends_no_selfie_field', async () => {
    // Overhaul 6.2: the selfie was removed from the screen. The backend has always taken
    // selfie_artifact_id as optional (schemas/transit.py), so it is omitted, not nulled.
    vi.doMock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))
    const mockPost = vi.fn().mockResolvedValue({ id: 'cp-2' })
    vi.doMock('@/lib/api/client', () => ({
      api: { get: vi.fn(), post: (...args: unknown[]) => mockPost(...args), postForm: vi.fn() },
    }))
    const mockUploadArtifact = vi.fn().mockResolvedValueOnce({ id: 'cargo-artifact', file_hash: 'b'.repeat(64) })
    vi.doMock('@/lib/api/artifacts', () => ({
      uploadArtifact: (...args: unknown[]) => mockUploadArtifact(...args),
    }))
    const { selfieDataUrl: _dropped, ...cargoOnly } = EVIDENCE

    const { submitCheckpoint } = await import('../checkpoints')
    await submitCheckpoint('trip-1', cargoOnly)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(1)
    expect(mockUploadArtifact).toHaveBeenCalledWith(expect.objectContaining({ dataUrl: EVIDENCE.cargoPhotoDataUrl }))
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(body.cargo_photo_artifact_id).toBe('cargo-artifact')
    expect(body).not.toHaveProperty('selfie_artifact_id')
  })

  it('test_replays_an_old_queued_checkpoint_that_still_carries_a_selfie', async () => {
    // A checkpoint queued offline by a build from before 6.2 is stored with its selfie.
    // The offline queue replays it through this same function; the selfie must still go.
    vi.doMock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))
    const mockPost = vi.fn().mockResolvedValue({ id: 'cp-3' })
    vi.doMock('@/lib/api/client', () => ({
      api: { get: vi.fn(), post: (...args: unknown[]) => mockPost(...args), postForm: vi.fn() },
    }))
    const mockUploadArtifact = vi.fn()
      .mockResolvedValueOnce({ id: 'cargo-artifact', file_hash: 'b'.repeat(64) })
      .mockResolvedValueOnce({ id: 'selfie-artifact', file_hash: 'a'.repeat(64) })
    vi.doMock('@/lib/api/artifacts', () => ({
      uploadArtifact: (...args: unknown[]) => mockUploadArtifact(...args),
    }))
    const queued = JSON.parse(JSON.stringify(EVIDENCE)) as CheckpointEvidence

    const { submitCheckpoint } = await import('../checkpoints')
    await submitCheckpoint('trip-1', queued)

    const body = mockPost.mock.calls[0][1] as Record<string, unknown>
    expect(mockUploadArtifact).toHaveBeenCalledTimes(2)
    expect(body.selfie_artifact_id).toEqual(expect.any(String))
    expect(body.cargo_photo_artifact_id).toEqual(expect.any(String))
  })
})
