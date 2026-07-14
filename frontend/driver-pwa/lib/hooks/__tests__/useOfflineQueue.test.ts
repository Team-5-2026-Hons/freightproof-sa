// frontend/driver-pwa/lib/hooks/__tests__/useOfflineQueue.test.ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useOfflineQueue } from '../useOfflineQueue'
import { ApiError } from '@/lib/api/client'
import type { H1Evidence } from '@/lib/types/evidence-draft'
import type { CheckpointEvidence } from '@/lib/api/checkpoints'

// Mock submitHandshake/raiseException/submitCheckpoint so tests don't hit the network
vi.mock('@/lib/api/handshakes', () => ({
  submitHandshake: vi.fn().mockResolvedValue({ ok: true, eventHash: 'abc' }),
}))
vi.mock('@/lib/api/exceptions', () => ({
  raiseException: vi.fn().mockResolvedValue({ id: 'exc-1' }),
}))
vi.mock('@/lib/api/checkpoints', () => ({
  submitCheckpoint: vi.fn().mockResolvedValue({ id: 'cp-1' }),
}))

beforeEach(() => localStorage.clear())

// gateAddress added to H1Evidence (Task 3) — included here as null since this
// fixture predates that field, same fix applied to useHandshakeDraft.test.ts.
const EVIDENCE: H1Evidence = {
  gpsLat: -26.09, gpsLng: 28.13, gatePhotoDataUrl: 'data:img', gateAddress: null, capturedAt: '2026-06-12T10:00:00Z',
}

const CHECKPOINT_EVIDENCE: CheckpointEvidence = {
  gpsLat: -29.85, gpsLng: 31.02,
  selfieDataUrl: 'data:img/selfie', cargoPhotoDataUrl: 'data:img/cargo',
  note: '', isDeviation: false, capturedAt: '2026-06-12T10:00:00Z',
}

describe('useOfflineQueue', () => {
  it('starts with empty queue', () => {
    const { result } = renderHook(() => useOfflineQueue())
    expect(result.current.queueLength).toBe(0)
  })

  it('enqueue increments queueLength and persists to localStorage', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    expect(result.current.queueLength).toBe(1)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored).toHaveLength(1)
    expect(stored[0].tripId).toBe('trip-1')
  })

  it('flush calls submitHandshake for each entry and clears the queue', async () => {
    const { submitHandshake } = await import('@/lib/api/handshakes')
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    await act(() => result.current.flush())
    expect(submitHandshake).toHaveBeenCalledTimes(1)
    expect(result.current.queueLength).toBe(0)
  })

  it('enqueueException increments queueLength and persists to localStorage', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'x' }))
    expect(result.current.queueLength).toBe(1)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored[0].kind).toBe('exception')
    expect(stored[0].tripId).toBe('trip-1')
  })

  it('flush calls raiseException for a queued exception and clears the queue', async () => {
    const { raiseException } = await import('@/lib/api/exceptions')
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueueException('trip-1', { exception_type: 'panic_button', description: 'x' }))
    await act(() => result.current.flush())
    expect(raiseException).toHaveBeenCalledWith('trip-1', { exception_type: 'panic_button', description: 'x' })
    expect(result.current.queueLength).toBe(0)
  })

  it('flush retains a failed entry in the queue and keeps unrelated entries', async () => {
    const { submitHandshake } = await import('@/lib/api/handshakes')
    vi.mocked(submitHandshake).mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1)
  })

  it('flush drops a terminal 4xx failure instead of retrying it forever', async () => {
    const { submitHandshake } = await import('@/lib/api/handshakes')
    vi.mocked(submitHandshake).mockRejectedValueOnce(new ApiError(422, 'invalid evidence'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(0)
  })

  it('flush retains an entry on a 5xx ApiError so it can be retried later', async () => {
    const { submitHandshake } = await import('@/lib/api/handshakes')
    vi.mocked(submitHandshake).mockRejectedValueOnce(new ApiError(503, 'service unavailable'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueue('trip-1', 'origin_gate_in', EVIDENCE))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1)
  })

  // Fix 3: checkpoints now enqueue and replay through the same offline-queue contract
  // as handshakes and exceptions.
  it('enqueueCheckpoint increments queueLength and persists to localStorage', () => {
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueueCheckpoint('trip-1', CHECKPOINT_EVIDENCE))
    expect(result.current.queueLength).toBe(1)
    const stored = JSON.parse(localStorage.getItem('fp_offline_queue') ?? '[]')
    expect(stored[0].kind).toBe('checkpoint')
    expect(stored[0].tripId).toBe('trip-1')
  })

  it('flush calls submitCheckpoint for a queued checkpoint and clears the queue', async () => {
    const { submitCheckpoint } = await import('@/lib/api/checkpoints')
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueueCheckpoint('trip-1', CHECKPOINT_EVIDENCE))
    await act(() => result.current.flush())
    expect(submitCheckpoint).toHaveBeenCalledWith('trip-1', CHECKPOINT_EVIDENCE)
    expect(result.current.queueLength).toBe(0)
  })

  it('flush retains a queued checkpoint on a 5xx ApiError so it can be retried later', async () => {
    const { submitCheckpoint } = await import('@/lib/api/checkpoints')
    vi.mocked(submitCheckpoint).mockRejectedValueOnce(new ApiError(503, 'service unavailable'))
    const { result } = renderHook(() => useOfflineQueue())
    act(() => result.current.enqueueCheckpoint('trip-1', CHECKPOINT_EVIDENCE))
    await act(() => result.current.flush())
    expect(result.current.queueLength).toBe(1)
  })
})
