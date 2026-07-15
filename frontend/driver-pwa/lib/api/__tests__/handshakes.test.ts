// frontend/driver-pwa/lib/api/__tests__/handshakes.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { H1Evidence, H2Evidence, H5Evidence } from '@/lib/types/evidence-draft'

// submitHandshake reads NEXT_PUBLIC_DEMO_MODE at module load time (IS_DEMO_MODE
// constant), so it must be set to 'false' before the module is imported in
// order to exercise the real-backend branch.
vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockPost = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: { get: vi.fn(), post: (...args: unknown[]) => mockPost(...args), postForm: vi.fn() },
}))

// uploadArtifact's data-URL -> Blob conversion is jsdom-incompatible (fetch('data:...')
// doesn't yield a FormData-appendable Blob in jsdom) and isn't what this file tests —
// mock it directly so these tests focus on handshakes.ts's orchestration logic.
const mockUploadArtifact = vi.fn()
vi.mock('@/lib/api/artifacts', () => ({
  uploadArtifact: (...args: unknown[]) => mockUploadArtifact(...args),
}))

const H1_EVIDENCE: H1Evidence = {
  gpsLat: -26.09,
  gpsLng: 28.13,
  gateAddress: null,
  capturedAt: '2026-06-12T10:00:00Z',
}

const H2_EVIDENCE: H2Evidence = {
  gpsLat: -26.09,
  gpsLng: 28.13,
  ppManifestParcelCount: 31,
  driverVisualCount: 31,
  waybillPhotoDataUrl: 'data:image/jpeg;base64,BBBB',
  sealNumber: 'AB-1234',
  sealPhotoDataUrl: 'data:image/jpeg;base64,CCCC',
  capturedAt: '2026-06-12T10:05:00Z',
}

const H5_EVIDENCE: H5Evidence = {
  waybillHandedOver: true,
  sealBrokenPhotoDataUrl: 'data:image/jpeg;base64,DDDD',
  driverVisualCount: 31,
  podPhotoDataUrl: 'data:image/jpeg;base64,EEEE',
  podSignatureDataUrl: 'data:image/png;base64,FFFF',
  reconciliationNote: null,
  capturedAt: '2026-06-12T10:10:00Z',
}

describe('submitHandshake (real-backend branch)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('completes H1 with GPS only, no artifact upload', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', status: 'origin_gate_in' })

    const { submitHandshake } = await import('../handshakes')
    const result = await submitHandshake('trip-1', 'origin_gate_in', H1_EVIDENCE)

    expect(result.ok).toBe(true)
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/handshakes/h1/complete',
      {
        driver_phone_lat: -26.09,
        driver_phone_lng: 28.13,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('uploads waybill and seal photos then completes H2 with both artifact ids', async () => {
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'waybill-artifact', file_hash: 'a'.repeat(64) })
      .mockResolvedValueOnce({ id: 'seal-artifact', file_hash: 'b'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', status: 'loading' })

    const { submitHandshake } = await import('../handshakes')
    await submitHandshake('trip-1', 'loading', H2_EVIDENCE)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(2)
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/handshakes/h2/complete',
      {
        waybill_photo_artifact_id: 'waybill-artifact',
        seal_number: 'AB-1234',
        seal_photo_artifact_id: 'seal-artifact',
        driver_visual_count: 31,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('completes H3 with the confirmed seal for server-side comparison, no artifact upload', async () => {
    mockPost.mockResolvedValue({ id: 'trip-1', status: 'in_transit' })

    const { submitHandshake } = await import('../handshakes')
    await submitHandshake('trip-1', 'origin_gate_out', {
      gpsLat: null,
      gpsLng: null,
      sealNumberConfirmed: ' AB-1234 ',
      // null = the device-local seal reference was lost — must NOT become
      // guard_verified_seal: false (the server compares the confirmed seal instead).
      sealVerifiedMatch: null,
      capturedAt: '2026-06-12T10:07:00Z',
    })

    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/handshakes/h3/complete',
      {
        guard_verified_seal: false,
        seal_number_confirmed: 'AB-1234',
      },
      { timeoutMs: 30_000 },
    )
  })

  it('throws when required evidence is missing instead of calling the backend', async () => {
    const { submitHandshake } = await import('../handshakes')
    const incomplete: H1Evidence = { ...H1_EVIDENCE, gpsLat: null }

    await expect(submitHandshake('trip-1', 'origin_gate_in', incomplete)).rejects.toThrow(
      /H1 evidence incomplete/,
    )
    expect(mockUploadArtifact).not.toHaveBeenCalled()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('propagates a backend rejection from the artifact upload', async () => {
    mockUploadArtifact.mockRejectedValue(new Error('upload failed: HTTP 500'))

    const { submitHandshake } = await import('../handshakes')

    await expect(submitHandshake('trip-1', 'loading', H2_EVIDENCE)).rejects.toThrow(
      /upload failed/,
    )
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('uploads POD photo and signature then completes H5 with both artifact ids', async () => {
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'pod-photo-artifact', file_hash: 'a'.repeat(64) })
      .mockResolvedValueOnce({ id: 'pod-signature-artifact', file_hash: 'b'.repeat(64) })
    mockPost.mockResolvedValue({ id: 'trip-1', status: 'closed' })

    const { submitHandshake } = await import('../handshakes')
    await submitHandshake('trip-1', 'unloading', H5_EVIDENCE)

    expect(mockUploadArtifact).toHaveBeenCalledTimes(2)
    expect(mockPost).toHaveBeenCalledWith(
      '/api/v1/trips/trip-1/handshakes/h5/complete',
      {
        pod_photo_artifact_id: 'pod-photo-artifact',
        pod_signature_artifact_id: 'pod-signature-artifact',
        driver_visual_count: 31,
        pp_scan_in_count: 31,
      },
      { timeoutMs: 30_000 },
    )
  })

  it('throws H5 incomplete when the signature is missing', async () => {
    const { submitHandshake } = await import('../handshakes')
    const incomplete: H5Evidence = { ...H5_EVIDENCE, podSignatureDataUrl: null }

    await expect(submitHandshake('trip-1', 'unloading', incomplete)).rejects.toThrow(
      /H5 evidence incomplete/,
    )
    expect(mockUploadArtifact).not.toHaveBeenCalled()
  })
})
