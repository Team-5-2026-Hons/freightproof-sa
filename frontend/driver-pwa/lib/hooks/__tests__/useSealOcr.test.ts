// frontend/driver-pwa/lib/hooks/__tests__/useSealOcr.test.ts
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SealReading } from '@/lib/ocr/readSeal'

const { mockRead, mockCanRead } = vi.hoisted(() => ({ mockRead: vi.fn(), mockCanRead: vi.fn() }))
vi.mock('@/lib/ocr/readSeal', () => ({
  readSealFromPhoto: (...a: unknown[]) => mockRead(...a),
  canReadSeals: () => mockCanRead(),
}))

import { useSealOcr } from '../useSealOcr'

function deferred() {
  let resolve: (r: SealReading) => void = () => {}
  const promise = new Promise<SealReading>((r) => { resolve = r })
  return { promise, resolve }
}

describe('useSealOcr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCanRead.mockReturnValue(true)
  })

  it('returns the number read and shows reading while it runs', async () => {
    const pending = deferred()
    mockRead.mockReturnValue(pending.promise)
    const { result } = renderHook(() => useSealOcr())

    let outcome: Promise<unknown> = Promise.resolve()
    act(() => { outcome = result.current.readSeal('photo-1') })
    expect(result.current.reading).toBe(true)

    await act(async () => { pending.resolve({ kind: 'found', value: 'AB-1234' }) })

    expect(await outcome).toEqual({ stale: false, value: 'AB-1234' })
    expect(result.current.reading).toBe(false)
  })

  it('treats none and unavailable alike: no value', async () => {
    mockRead.mockResolvedValue({ kind: 'unavailable' })
    const { result } = renderHook(() => useSealOcr())

    let outcome: unknown
    await act(async () => { outcome = await result.current.readSeal('photo-1') })

    expect(outcome).toEqual({ stale: false, value: null })
  })

  it('marks an earlier read stale once a retake has started a newer one', async () => {
    const first = deferred()
    const second = deferred()
    mockRead.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useSealOcr())

    let firstOutcome: Promise<unknown> = Promise.resolve()
    let secondOutcome: Promise<unknown> = Promise.resolve()
    act(() => {
      firstOutcome = result.current.readSeal('photo-1')
      secondOutcome = result.current.readSeal('photo-2')
    })
    await act(async () => {
      second.resolve({ kind: 'found', value: 'CD-5678' })
      first.resolve({ kind: 'found', value: 'AB-1234' })
    })

    expect(await firstOutcome).toEqual({ stale: true })
    expect(await secondOutcome).toEqual({ stale: false, value: 'CD-5678' })
  })

  it('answers no value at once in the browser, without ever showing reading', async () => {
    mockCanRead.mockReturnValue(false)
    const seen: boolean[] = []
    const { result } = renderHook(() => {
      const state = useSealOcr()
      seen.push(state.reading)
      return state
    })

    let outcome: unknown
    await act(async () => { outcome = await result.current.readSeal('photo-1') })

    expect(outcome).toEqual({ stale: false, value: null })
    expect(mockRead).not.toHaveBeenCalled()
    expect(seen).not.toContain(true)
  })

  it('treats a read that throws as no value and stops showing reading', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockRead.mockRejectedValue(new Error('plugin missing'))
    const { result } = renderHook(() => useSealOcr())

    let outcome: unknown
    await act(async () => { outcome = await result.current.readSeal('photo-1') })

    expect(outcome).toEqual({ stale: false, value: null })
    expect(result.current.reading).toBe(false)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('a stale read finishing does not clear the newer read\'s reading flag', async () => {
    const first = deferred()
    const second = deferred()
    mockRead.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { result } = renderHook(() => useSealOcr())

    act(() => {
      void result.current.readSeal('photo-1')
      void result.current.readSeal('photo-2')
    })
    await act(async () => { first.resolve({ kind: 'found', value: 'AB-1234' }) })

    expect(result.current.reading).toBe(true)

    await act(async () => { second.resolve({ kind: 'none' }) })

    expect(result.current.reading).toBe(false)
  })
})
