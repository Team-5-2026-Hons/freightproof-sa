import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { COPIED_RESET_MS, useCopyToClipboard } from './useCopyToClipboard'

const writeText = vi.fn<(text: string) => Promise<void>>()

beforeEach(() => {
  vi.useFakeTimers()
  writeText.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useCopyToClipboard', () => {
  it('sets copied after a successful write, then clears it after the reset delay', async () => {
    const { result } = renderHook(() => useCopyToClipboard())

    await act(async () => { await result.current.copy('abc') })

    expect(writeText).toHaveBeenCalledWith('abc')
    expect(result.current.copied).toBe(true)

    act(() => { vi.advanceTimersByTime(COPIED_RESET_MS) })

    expect(result.current.copied).toBe(false)
  })

  it('leaves copied false and warns when the clipboard refuses', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const refusal = new Error('NotAllowedError')
    writeText.mockRejectedValue(refusal)
    const { result } = renderHook(() => useCopyToClipboard())

    await act(async () => { await result.current.copy('abc') })

    expect(result.current.copied).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('clipboard'), refusal)
  })

  it('treats a missing clipboard API as a refusal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    const { result } = renderHook(() => useCopyToClipboard())

    await act(async () => { await result.current.copy('abc') })

    expect(result.current.copied).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  it('restarts the reset delay when copied again before it elapses', async () => {
    const { result } = renderHook(() => useCopyToClipboard())
    await act(async () => { await result.current.copy('abc') })
    act(() => { vi.advanceTimersByTime(COPIED_RESET_MS - 1) })

    await act(async () => { await result.current.copy('abc') })
    act(() => { vi.advanceTimersByTime(COPIED_RESET_MS - 1) })

    expect(result.current.copied).toBe(true)
  })

  it('clears its reset timer on unmount', async () => {
    const { result, unmount } = renderHook(() => useCopyToClipboard())
    await act(async () => { await result.current.copy('abc') })
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
