// frontend/driver-pwa/lib/hooks/__tests__/useTripAutoRefresh.test.ts
//
// Follows the arrange/act/assert style and fake-timer usage of usePhaseDraft.test.ts
// and the visibilitychange/online-event patterns already exercised in
// useOfflineQueue.test.ts and components/layout/__tests__/OfflineBanner.test.tsx.
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTripAutoRefresh } from '../useTripAutoRefresh'

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

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      await Promise.resolve()
    })
    expect(onRefresh).toHaveBeenCalledTimes(1)

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

    onRefresh.mockClear()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000)
    })
    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('test_reconnect_refreshes_even_with_polling_off', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useTripAutoRefresh({ pollingEnabled: false, intervalMs: 1000, onRefresh }))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await Promise.resolve()
    })

    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('test_reconnect_listener_is_removed_on_unmount', async () => {
    const onRefresh = vi.fn().mockResolvedValue(undefined)
    const { unmount } = renderHook(() => useTripAutoRefresh({ pollingEnabled: false, intervalMs: 1000, onRefresh }))

    unmount()
    await act(async () => {
      window.dispatchEvent(new Event('online'))
      await Promise.resolve()
    })

    expect(onRefresh).not.toHaveBeenCalled()
  })
})
