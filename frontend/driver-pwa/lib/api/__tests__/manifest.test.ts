// frontend/driver-pwa/lib/api/__tests__/manifest.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Fix 8: components/handshake/steps/H2Linehaul.tsx already calls fetchLinehaul directly
// with its own loading/error/retry UI — the gap was that fetchLinehaul had no demo-mode
// gate (unlike lib/api/handshakes.ts's submitHandshake), so it fired a real fetch at
// localhost:8000 and always failed in demo mode (the default). These tests cover the
// gate added to close that gap.
describe('fetchLinehaul (Fix 8: demo-mode gate)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('short-circuits with a fake Linehaul in demo mode instead of hitting the network', async () => {
    vi.doMock('@/lib/constants/env', () => ({ IS_DEMO_MODE: true }))
    const mockGet = vi.fn()
    vi.doMock('@/lib/api/client', () => ({
      api: { get: (...args: unknown[]) => mockGet(...args), post: vi.fn(), postForm: vi.fn() },
    }))

    const { fetchLinehaul } = await import('../manifest')
    const promise = fetchLinehaul('trip-1')
    await vi.advanceTimersByTimeAsync(500)
    const result = await promise

    expect(result.trip_id).toBe('trip-1')
    expect(result.consolidated_unit_count).toBeGreaterThan(0)
    expect(mockGet).not.toHaveBeenCalled()
  })

  it('calls the real manifest endpoint in the real-backend branch', async () => {
    vi.doMock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))
    const linehaul = {
      trip_id: 'trip-1', vehicle_registration: 'GP 12-34 ZX', vehicle_type: 'Interlink',
      driver_full_name: 'Sipho Dlamini', consolidated_unit_count: 27,
      origin_scan_complete: true, pulled_at: '2026-06-12T10:00:00Z',
    }
    const mockGet = vi.fn().mockResolvedValue(linehaul)
    vi.doMock('@/lib/api/client', () => ({
      api: { get: (...args: unknown[]) => mockGet(...args), post: vi.fn(), postForm: vi.fn() },
    }))

    const { fetchLinehaul } = await import('../manifest')
    const result = await fetchLinehaul('trip-1')

    expect(mockGet).toHaveBeenCalledWith('/api/v1/trips/trip-1/manifest')
    expect(result).toEqual(linehaul)
  })
})
