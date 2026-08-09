// frontend/driver-pwa/lib/hooks/__tests__/useVisualCountCarry.test.ts
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useVisualCountCarry } from '../useVisualCountCarry'

beforeEach(() => {
  localStorage.clear()
})

describe('useVisualCountCarry', () => {
  it('starts null when nothing is stored for the trip', () => {
    const { result } = renderHook(() => useVisualCountCarry('trip-1'))

    expect(result.current[0]).toBeNull()
  })

  it('persists a count to localStorage under a per-trip key', () => {
    const { result } = renderHook(() => useVisualCountCarry('trip-1'))

    act(() => result.current[1](42))

    expect(result.current[0]).toBe(42)
    expect(localStorage.getItem('fp:visual-count-carry:trip-1')).toBe('42')
  })

  it('persists zero — a legitimate flaggable count, not treated as unset', () => {
    const { result } = renderHook(() => useVisualCountCarry('trip-1'))

    act(() => result.current[1](0))

    expect(result.current[0]).toBe(0)
    expect(localStorage.getItem('fp:visual-count-carry:trip-1')).toBe('0')
  })

  it('survives a remount (reads from localStorage on mount)', () => {
    const first = renderHook(() => useVisualCountCarry('trip-1'))
    act(() => first.result.current[1](17))
    first.unmount()

    const second = renderHook(() => useVisualCountCarry('trip-1'))

    expect(second.result.current[0]).toBe(17)
  })

  it('clearCount removes the value from state and storage', () => {
    const { result } = renderHook(() => useVisualCountCarry('trip-1'))
    act(() => result.current[1](8))

    act(() => result.current[2]())

    expect(result.current[0]).toBeNull()
    expect(localStorage.getItem('fp:visual-count-carry:trip-1')).toBeNull()
  })

  it('keeps different trips isolated under different keys', () => {
    const tripA = renderHook(() => useVisualCountCarry('trip-a'))
    const tripB = renderHook(() => useVisualCountCarry('trip-b'))

    act(() => tripA.result.current[1](5))

    expect(tripA.result.current[0]).toBe(5)
    expect(tripB.result.current[0]).toBeNull()
  })
})
