import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { captureWithinBudget, REPORT_CAPTURE_BUDGET_MS } from '../bounded-capture'
import type { LocationCoords } from '@/lib/hooks/useLocation'

const FIX: LocationCoords = { latitude: -26.09, longitude: 28.13, accuracy: 5, capturedAt: '2026-09-16T10:00:00.000Z' }

describe('captureWithinBudget', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('returns a fix that arrives inside the budget', async () => {
    const capture = vi.fn().mockResolvedValue(FIX)

    await expect(captureWithinBudget(capture)).resolves.toEqual(FIX)
  })

  it('returns null when capture itself resolves null', async () => {
    const capture = vi.fn().mockResolvedValue(null)

    await expect(captureWithinBudget(capture)).resolves.toBeNull()
  })

  it('gives up with null once the budget elapses, without waiting for a stalled capture', async () => {
    const capture = vi.fn().mockReturnValue(new Promise<LocationCoords | null>(() => {}))

    const result = captureWithinBudget(capture)
    await vi.advanceTimersByTimeAsync(REPORT_CAPTURE_BUDGET_MS)

    await expect(result).resolves.toBeNull()
  })

  it('discards a fix that arrives after the budget rather than attaching it late', async () => {
    let resolveLate: (fix: LocationCoords) => void = () => {}
    const capture = vi.fn().mockReturnValue(new Promise<LocationCoords | null>(resolve => { resolveLate = resolve }))

    const result = captureWithinBudget(capture, 500)
    await vi.advanceTimersByTimeAsync(500)
    resolveLate(FIX)

    await expect(result).resolves.toBeNull()
  })

  it('never rejects, even if the capture implementation throws', async () => {
    const capture = vi.fn().mockRejectedValue(new Error('geolocation exploded'))

    await expect(captureWithinBudget(capture)).resolves.toBeNull()
  })
})
