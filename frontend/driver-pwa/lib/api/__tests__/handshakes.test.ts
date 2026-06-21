// frontend/driver-pwa/lib/api/__tests__/handshakes.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { H1Evidence } from '@/lib/types/evidence-draft'

// submitHandshake reads NEXT_PUBLIC_DEMO_MODE at module load time (IS_DEMO_MODE
// constant), so it must be set to 'false' before the module is imported in
// order to exercise the real-backend fetch branch.
process.env.NEXT_PUBLIC_DEMO_MODE = 'false'

const EVIDENCE: H1Evidence = {
  gpsLat: -26.09,
  gpsLng: 28.13,
  gatePhotoDataUrl: 'data:img',
  gateAddress: null,
  capturedAt: '2026-06-12T10:00:00Z',
}

describe('submitHandshake (real-backend branch)', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('resolves with the parsed result when the backend returns ok: true', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true, eventHash: 'hash-123' }),
      }),
    )
    const { submitHandshake } = await import('../handshakes')

    const result = await submitHandshake('trip-1', 'origin_gate_in', EVIDENCE)

    expect(result).toEqual({ ok: true, eventHash: 'hash-123' })
  })

  it('throws when the HTTP response itself is not ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      }),
    )
    const { submitHandshake } = await import('../handshakes')

    await expect(submitHandshake('trip-1', 'origin_gate_in', EVIDENCE)).rejects.toThrow(
      /HTTP 500/,
    )
  })

  it('throws when the response is HTTP 200 but the parsed body has ok: false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: false, eventHash: '' }),
      }),
    )
    const { submitHandshake } = await import('../handshakes')

    await expect(submitHandshake('trip-1', 'origin_gate_in', EVIDENCE)).rejects.toThrow(
      /ok: false/,
    )
  })
})
