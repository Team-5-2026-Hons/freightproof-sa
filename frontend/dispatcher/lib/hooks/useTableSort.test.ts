import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useTableSort } from './useTableSort'

const KEYS = ['date', 'name'] as const
const firstDir = (key: typeof KEYS[number]): 'asc' | 'desc' => (key === 'date' ? 'desc' : 'asc')

describe('useTableSort', () => {
  it('stays unsorted until a header is clicked when there is no initial sort', () => {
    const { result } = renderHook(() => useTableSort({ keys: KEYS, firstDir }))

    expect(result.current.sort).toBeUndefined()
    expect(result.current.tableSort).toBeUndefined()
  })

  it('opens on the initial sort, in the Table\'s own id/dir shape', () => {
    const { result } = renderHook(() => useTableSort({ keys: KEYS, firstDir, initial: { key: 'date', dir: 'desc' } }))

    expect(result.current.sort).toEqual({ key: 'date', dir: 'desc' })
    expect(result.current.tableSort).toEqual({ id: 'date', dir: 'desc' })
  })

  it('sorts a clicked column its own way first, then flips it', () => {
    const { result } = renderHook(() => useTableSort({ keys: KEYS, firstDir }))

    act(() => result.current.onSort('name'))
    expect(result.current.tableSort).toEqual({ id: 'name', dir: 'asc' })

    act(() => result.current.onSort('name'))
    expect(result.current.tableSort).toEqual({ id: 'name', dir: 'desc' })

    act(() => result.current.onSort('date'))
    expect(result.current.tableSort).toEqual({ id: 'date', dir: 'desc' })
  })

  it('ignores a click on a column that cannot sort', () => {
    const { result } = renderHook(() => useTableSort({ keys: KEYS, firstDir }))

    act(() => result.current.onSort('phone'))

    expect(result.current.sort).toBeUndefined()
  })
})
