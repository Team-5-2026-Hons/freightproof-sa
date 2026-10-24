// frontend/driver-pwa/lib/hooks/__tests__/useArtifactUpload.test.ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { authenticateTestDriver } from '@/lib/session/testing/custody'
import { useArtifactUpload } from '../useArtifactUpload'

// The hook only runs its real-upload branch outside demo mode.
vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockUploadArtifact = vi.fn()
vi.mock('@/lib/api/artifacts', () => ({
  uploadArtifact: (...args: unknown[]) => mockUploadArtifact(...args),
}))

interface Deferred {
  promise: Promise<{ id: string; file_hash: string }>
  resolve: (id: string) => void
}

// Lets a test decide when each upload "lands", so it can resolve them out of order.
function deferredUpload(): Deferred {
  let resolveFn: (value: { id: string; file_hash: string }) => void = () => {}
  const promise = new Promise<{ id: string; file_hash: string }>((resolve) => {
    resolveFn = resolve
  })
  return { promise, resolve: (id) => resolveFn({ id, file_hash: 'h' }) }
}

const CAPTURED_AT = '2026-10-12T10:00:00Z'

describe('useArtifactUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authenticateTestDriver('trip-1', 2)
  })

  it('retake before the first upload resolves keeps the retake', async () => {
    const first = deferredUpload()
    const second = deferredUpload()
    mockUploadArtifact
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useArtifactUpload('trip-1', 'phase-1'))

    let firstResult: Promise<string | null> = Promise.resolve(null)
    let secondResult: Promise<string | null> = Promise.resolve(null)
    act(() => {
      firstResult = result.current.uploadNow('data:a', 'photo', CAPTURED_AT, 'seal_photo')
      secondResult = result.current.uploadNow('data:b', 'photo', CAPTURED_AT, 'seal_photo')
    })
    // Out of order on purpose: the older request lands last, which is the bug this guards.
    await act(async () => {
      second.resolve('retake-id')
      first.resolve('stale-id')
    })

    await expect(firstResult).resolves.toBeNull()
    await expect(secondResult).resolves.toBe('retake-id')
  })

  it('does not let an upload for one role supersede an upload for another', async () => {
    mockUploadArtifact
      .mockResolvedValueOnce({ id: 'seal-id', file_hash: 'h' })
      .mockResolvedValueOnce({ id: 'waybill-id', file_hash: 'h' })
    const { result } = renderHook(() => useArtifactUpload('trip-1', 'phase-1'))

    let sealId: string | null = null
    let waybillId: string | null = null
    await act(async () => {
      const seal = result.current.uploadNow('data:a', 'photo', CAPTURED_AT, 'seal_photo')
      const waybill = result.current.uploadNow('data:b', 'photo', CAPTURED_AT, 'waybill_photo')
      sealId = await seal
      waybillId = await waybill
    })

    expect(sealId).toBe('seal-id')
    expect(waybillId).toBe('waybill-id')
  })

  it('unmount resolves null', async () => {
    const pending = deferredUpload()
    mockUploadArtifact.mockReturnValueOnce(pending.promise)
    const { result, unmount } = renderHook(() => useArtifactUpload('trip-1', 'phase-1'))

    let outcome: Promise<string | null> = Promise.resolve('unset')
    act(() => {
      outcome = result.current.uploadNow('data:a', 'photo', CAPTURED_AT, 'seal_photo')
    })
    unmount()
    await act(async () => {
      pending.resolve('late-id')
    })

    await expect(outcome).resolves.toBeNull()
  })

  it('attribution is forwarded', async () => {
    mockUploadArtifact.mockResolvedValueOnce({ id: 'artifact-1', file_hash: 'h' })
    const { result } = renderHook(() => useArtifactUpload('trip-1', 'phase-1'))

    let id: string | null = null
    await act(async () => {
      id = await result.current.uploadNow('data:a', 'photo', CAPTURED_AT, 'pod_photo')
    })

    expect(id).toBe('artifact-1')
    expect(mockUploadArtifact).toHaveBeenCalledWith({
      tripId: 'trip-1',
      artifactType: 'photo',
      dataUrl: 'data:a',
      capturedAt: CAPTURED_AT,
      attribution: { phaseEventId: 'phase-1', role: 'pod_photo' },
      custodySequence: 2,
    })
  })
})
