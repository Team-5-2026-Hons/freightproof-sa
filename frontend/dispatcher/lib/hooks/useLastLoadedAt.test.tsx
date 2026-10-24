import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLastLoadedAt } from './useLastLoadedAt'

describe('useLastLoadedAt', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('moves_when_new_data_arrives_and_holds_when_the_same_data_is_rendered_again', () => {
    vi.setSystemTime(new Date('2026-10-22T08:00:00Z'))
    const first = [1]
    const { result, rerender } = renderHook(({ data }: { data: number[] }) => useLastLoadedAt(data), { initialProps: { data: first } })
    const loadedAt = result.current

    vi.setSystemTime(new Date('2026-10-22T08:05:00Z'))
    rerender({ data: first })
    expect(result.current).toBe(loadedAt)

    rerender({ data: [2] })
    expect(result.current.toISOString()).toBe('2026-10-22T08:05:00.000Z')
  })
})
