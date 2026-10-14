// Tests for the rotating-QR hook (FP-237).
//
// Three behaviours carry the feature and each is fenced below:
//
//   1. It re-issues on the server's cadence, not one this app invented.
//   2. It STOPS re-issuing once the receiver has the link open. If it kept going, every
//      real handover would have its code retired mid-signature and fail at the swipe —
//      the exact bug the server-side pause exists to prevent, reintroduced client-side.
//   3. It stops everything once confirmed, so a closed handover does not keep polling.
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useRotatingHandover } from '@/lib/hooks/useRotatingHandover'

vi.mock('@/lib/api/handover', () => ({
  issueHandoverToken: vi.fn(),
  fetchHandoverStatus: vi.fn(),
}))

const { issueHandoverToken, fetchHandoverStatus } = await import('@/lib/api/handover')

const TRIP = 'trip-1'
const EVENT = 'event-1'

const UNCONFIRMED = {
  confirmed: false, confirmed_at: null, receiver_opened: false, signature_artifact_id: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(issueHandoverToken).mockResolvedValue({
    scan_url: 'https://r.test/h/aaa',
    expires_at: '2026-09-13T10:10:00Z',
    rotate_after_seconds: 20,
    receiver_opened: false,
  })
  vi.mocked(fetchHandoverStatus).mockResolvedValue(UNCONFIRMED)
})

afterEach(() => vi.useRealTimers())

describe('useRotatingHandover', () => {
  it('issues a token on mount', async () => {
    const { result } = renderHook(() => useRotatingHandover(TRIP, EVENT))

    await waitFor(() => expect(result.current.scanUrl).toBe('https://r.test/h/aaa'))
  })

  it('re-issues when the server-specified interval elapses', async () => {
    vi.useFakeTimers()
    renderHook(() => useRotatingHandover(TRIP, EVENT))
    await vi.waitFor(() => expect(issueHandoverToken).toHaveBeenCalledTimes(1))

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })

    expect(issueHandoverToken).toHaveBeenCalledTimes(2)
  })

  it('stops re-issuing once the receiver has the link open', async () => {
    vi.useFakeTimers()
    vi.mocked(fetchHandoverStatus).mockResolvedValue({ ...UNCONFIRMED, receiver_opened: true })
    const { result } = renderHook(() => useRotatingHandover(TRIP, EVENT))

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })
    const issuedByNow = vi.mocked(issueHandoverToken).mock.calls.length

    await act(async () => { await vi.advanceTimersByTimeAsync(90_000) })

    expect(result.current.receiverOpened).toBe(true)
    expect(issueHandoverToken).toHaveBeenCalledTimes(issuedByNow)
  })

  it('keeps the current QR on screen when a paused response carries no url', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useRotatingHandover(TRIP, EVENT))
    await vi.waitFor(() => expect(result.current.scanUrl).toBe('https://r.test/h/aaa'))
    vi.mocked(issueHandoverToken).mockResolvedValue({
      scan_url: null,
      expires_at: '2026-09-13T10:10:00Z',
      rotate_after_seconds: 20,
      receiver_opened: true,
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })

    expect(result.current.scanUrl).toBe('https://r.test/h/aaa')
  })

  it('stops everything and reports the artifact once the receiver confirms', async () => {
    vi.useFakeTimers()
    vi.mocked(fetchHandoverStatus).mockResolvedValue({
      confirmed: true,
      confirmed_at: '2026-09-13T10:05:00Z',
      receiver_opened: true,
      signature_artifact_id: 'art-1',
    })
    const { result } = renderHook(() => useRotatingHandover(TRIP, EVENT))

    await act(async () => { await vi.advanceTimersByTimeAsync(4_000) })

    expect(result.current.signatureArtifactId).toBe('art-1')
    const issuedByNow = vi.mocked(issueHandoverToken).mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(issueHandoverToken).toHaveBeenCalledTimes(issuedByNow)
  })

  it('surfaces an issue failure without crashing the step', async () => {
    vi.mocked(issueHandoverToken).mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() => useRotatingHandover(TRIP, EVENT))

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.scanUrl).toBeNull()
  })

  it('keeps the last good QR on screen when a later refresh fails', async () => {
    const { result } = renderHook(() => useRotatingHandover(TRIP, EVENT))
    await waitFor(() => expect(result.current.scanUrl).toBe('https://r.test/h/aaa'))

    vi.mocked(issueHandoverToken).mockRejectedValue(new Error('offline'))
    await act(async () => { result.current.forceNewCode() })

    await waitFor(() => expect(result.current.error).not.toBeNull())
    // Still valid until its own expiry — blanking it would take a working code away from
    // a receiver mid-scan because a later refresh failed.
    expect(result.current.scanUrl).toBe('https://r.test/h/aaa')
  })

  it('forceNewCode asks the server to override the pause', async () => {
    const { result } = renderHook(() => useRotatingHandover(TRIP, EVENT))
    await waitFor(() => expect(issueHandoverToken).toHaveBeenCalled())

    await act(async () => { result.current.forceNewCode() })

    await waitFor(() => expect(issueHandoverToken).toHaveBeenCalledWith(TRIP, EVENT, true))
  })

  it('a poll failure is swallowed rather than shown under a working QR', async () => {
    vi.mocked(fetchHandoverStatus).mockRejectedValue(new Error('flaky'))
    const { result } = renderHook(() => useRotatingHandover(TRIP, EVENT))

    await waitFor(() => expect(result.current.scanUrl).toBe('https://r.test/h/aaa'))
    expect(result.current.error).toBeNull()
  })
})
