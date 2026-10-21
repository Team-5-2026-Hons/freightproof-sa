// frontend/driver-pwa/lib/hooks/__tests__/useScrolledPastTop.test.ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useScrolledPastTop } from '../useScrolledPastTop'

let frames: FrameRequestCallback[] = []

beforeEach(() => {
  frames = []
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
    frames.push(cb)
    return frames.length
  })
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 120 })
})

afterEach(() => {
  vi.restoreAllMocks()
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })
})

describe('useScrolledPastTop', () => {
  it('does not read the scroll position while the screen mounts', () => {
    const { result } = renderHook(() => useScrolledPastTop())

    expect(result.current).toBe(false)
    expect(frames).toHaveLength(1)
  })

  it('reads it on the next frame', () => {
    const { result } = renderHook(() => useScrolledPastTop())

    act(() => frames[0](0))

    expect(result.current).toBe(true)
  })

  it('follows scrolling after that', () => {
    const { result } = renderHook(() => useScrolledPastTop())
    act(() => frames[0](0))
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 })

    act(() => { window.dispatchEvent(new Event('scroll')) })

    expect(result.current).toBe(false)
  })

  it('cancels the pending read when the screen unmounts first', () => {
    const { unmount } = renderHook(() => useScrolledPastTop())

    unmount()

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1)
  })
})
