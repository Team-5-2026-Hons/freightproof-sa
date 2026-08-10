// frontend/driver-pwa/lib/api/__tests__/checkpoints.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { CheckpointEvidence } from '../checkpoints'

const EVIDENCE: CheckpointEvidence = {
  gpsLat: -29.85, gpsLng: 31.02,
  selfieDataUrl: 'data:image/jpeg;base64,AAAA',
  cargoPhotoDataUrl: 'data:image/jpeg;base64,BBBB',
  note: 'All good.', isDeviation: false,
  capturedAt: '2026-06-12T10:00:00Z',
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
      .mockResolvedValueOnce({ id: 'selfie-artifact', file_hash: 'a'.repeat(64) })
      .mockResolvedValueOnce({ id: 'cargo-artifact', file_hash: 'b'.repeat(64) })
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
      selfie_artifact_id: 'selfie-artifact',
      cargo_photo_artifact_id: 'cargo-artifact',
      note: 'All good.',
      is_deviation: false,
    })
    expect(result).toEqual({ id: 'cp-1' })
  })
})
