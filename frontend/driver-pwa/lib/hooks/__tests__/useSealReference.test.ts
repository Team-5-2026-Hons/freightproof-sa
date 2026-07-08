// frontend/driver-pwa/lib/hooks/__tests__/useSealReference.test.ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useSealReference } from '../useSealReference'

beforeEach(() => {
  localStorage.clear()
})

describe('useSealReference', () => {
  it('starts null when nothing is stored for the trip', () => {
    const { result } = renderHook(() => useSealReference('trip-1'))

    expect(result.current[0]).toBeNull()
  })

  it('persists a seal to localStorage under a per-trip key', () => {
    const { result } = renderHook(() => useSealReference('trip-1'))

    act(() => result.current[1]('FP-1234'))

    expect(result.current[0]).toBe('FP-1234')
    expect(localStorage.getItem('fp:seal-reference:trip-1')).toBe('FP-1234')
  })

  it('survives a remount (reads from localStorage on mount)', () => {
    const first = renderHook(() => useSealReference('trip-1'))
    act(() => first.result.current[1]('FP-5678'))
    first.unmount()

    const second = renderHook(() => useSealReference('trip-1'))

    expect(second.result.current[0]).toBe('FP-5678')
  })

  it('clearSealReference removes the value from state and storage', () => {
    const { result } = renderHook(() => useSealReference('trip-1'))
    act(() => result.current[1]('FP-1234'))

    act(() => result.current[2]())

    expect(result.current[0]).toBeNull()
    expect(localStorage.getItem('fp:seal-reference:trip-1')).toBeNull()
  })

  it('keeps different trips isolated under different keys', () => {
    const tripA = renderHook(() => useSealReference('trip-a'))
    const tripB = renderHook(() => useSealReference('trip-b'))

    act(() => tripA.result.current[1]('FP-AAAA'))

    expect(tripA.result.current[0]).toBe('FP-AAAA')
    expect(tripB.result.current[0]).toBeNull()
  })
})
