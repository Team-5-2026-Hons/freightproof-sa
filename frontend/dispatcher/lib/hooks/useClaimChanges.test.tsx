import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { CLAIM_HIGHLIGHT_MS, useClaimChanges } from './useClaimChanges'

type Item = Parameters<typeof useClaimChanges>[0][number]
const item = (id: string, claimedBy: string | null = null, name: string | null = null): Item => ({
  id: id as Item['id'], exception_type: 'gps_mismatch', claimed_by_user_id: claimedBy, claimed_by_name: name,
})

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('useClaimChanges', () => {
  it('flags nothing on the first load', () => {
    const { result } = renderHook(() => useClaimChanges([item('a', 'u1', 'Tim')]))
    expect(result.current.highlighted.size).toBe(0)
    expect(result.current.announcement).toBe('')
  })

  it('highlights and announces a colleague claiming a visible exception', () => {
    const { result, rerender } = renderHook(({ items }) => useClaimChanges(items), { initialProps: { items: [item('a')] } })
    rerender({ items: [item('a', 'u1', 'Tim')] })
    expect([...result.current.highlighted]).toEqual(['a'])
    expect(result.current.announcement).toBe('Tim claimed GPS mismatch')
  })

  it('announces a released claim', () => {
    const { result, rerender } = renderHook(({ items }) => useClaimChanges(items), { initialProps: { items: [item('a', 'u1', 'Tim')] } })
    rerender({ items: [item('a')] })
    expect(result.current.announcement).toBe('Claim released on GPS mismatch')
  })

  it('does not treat a newly appearing exception, or an unchanged refetch, as a claim change', () => {
    const { result, rerender } = renderHook(({ items }) => useClaimChanges(items), { initialProps: { items: [item('a')] } })
    rerender({ items: [item('a'), item('b', 'u1', 'Tim')] })
    expect(result.current.highlighted.size).toBe(0)
    rerender({ items: [item('a'), item('b', 'u1', 'Tim')] })
    expect(result.current.highlighted.size).toBe(0)
  })

  it('clears the highlight after a few seconds but keeps the announcement', () => {
    const { result, rerender } = renderHook(({ items }) => useClaimChanges(items), { initialProps: { items: [item('a')] } })
    rerender({ items: [item('a', 'u1', 'Tim')] })
    act(() => { vi.advanceTimersByTime(CLAIM_HIGHLIGHT_MS + 1) })
    expect(result.current.highlighted.size).toBe(0)
    expect(result.current.announcement).toBe('Tim claimed GPS mismatch')
  })
})
