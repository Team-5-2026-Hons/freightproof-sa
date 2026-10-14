// frontend/driver-pwa/lib/hooks/__tests__/useTripAutoRefresh.test.ts
//
// Follows the arrange/act/assert style and fake-timer usage of usePhaseDraft.test.ts
// and the visibilitychange/online-event patterns already exercised in
// useOfflineQueue.test.ts and components/layout/__tests__/OfflineBanner.test.tsx.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTripAutoRefresh } from '../useTripAutoRefresh'

// jsdom defaults navigator.onLine to true; each test that cares overrides the getter,
// same pattern OfflineBanner.test.tsx already uses.
function setOnline(online: boolean): void {
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online)
}

function setVisibility(state: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

beforeEach(() => {
  setOnline(true)
  setVisibility('visible')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('useTripAutoRefresh', () => {
  it('checks immediately when polling turns on, then at intervalMs', async () => {
    vi.useFakeTimers()
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useTripAutoRefresh({ pollingEnabled: true, intervalMs: 1000, onRefresh }))

    // Leading edge, before any time passes: the gate can close before this hook ever
    // mounts, so the plan on screen may already be stale on arrival. Waiting for the first
    // tick to find that out is what made the blocked step look frozen to a driver standing
    // at the gate.
    await act(async () => {
      await Promise.resolve()
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onRefresh).toHaveBeenCalledTimes(2)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000)
    })
    expect(onRefresh).toHaveBeenCalledTimes(4)
  })

  it('issues no interval calls while pollingEnabled is false', async () => {
    vi.useFakeTimers()
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useTripAutoRefresh({ pollingEnabled: false, intervalMs: 1000, onRefresh }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('refreshes on visibilitychange to visible even when pollingEnabled is false', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useTripAutoRefresh({ pollingEnabled: false, intervalMs: 15_000, onRefresh }))

    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('does not refresh on a visibilitychange to "hidden"', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useTripAutoRefresh({ pollingEnabled: false, intervalMs: 15_000, onRefresh }))

    setVisibility('hidden')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('collapses an interval tick and a focus event racing together into one in-flight refresh', async () => {
    vi.useFakeTimers()
    let resolveRefresh: () => void = () => {}
    const onRefresh = vi.fn(() => new Promise<void>((resolve) => { resolveRefresh = resolve }))
    renderHook(() => useTripAutoRefresh({ pollingEnabled: true, intervalMs: 1000, onRefresh }))

    // The leading-edge check starts a refresh that deliberately never resolves on its own —
    // simulates a slow request still in flight when the next trigger fires. The interval
    // tick at 1000ms lands while it is still pending and must be collapsed into it, which
    // is why the count stays at 1 rather than reaching 2 here.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)

    // A focus event lands while that refresh is still pending — must not start a second.
    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)

    // Let it settle so the in-flight guard clears and doesn't leak into another test.
    await act(async () => {
      resolveRefresh()
      await Promise.resolve()
    })
  })

  it('skips the refresh when navigator.onLine is false', async () => {
    setOnline(false)
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useTripAutoRefresh({ pollingEnabled: false, intervalMs: 15_000, onRefresh }))

    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('clears the interval and removes both listeners on unmount', async () => {
    vi.useFakeTimers()
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const removeDocSpy = vi.spyOn(document, 'removeEventListener')
    const removeWinSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = renderHook(() =>
      useTripAutoRefresh({ pollingEnabled: true, intervalMs: 1000, onRefresh }),
    )

    unmount()

    expect(removeDocSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    expect(removeWinSpy).toHaveBeenCalledWith('focus', expect.any(Function))

    // The interval itself must be gone too — no further ticks after unmount.
    onRefresh.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(onRefresh).not.toHaveBeenCalled()
  })
})
