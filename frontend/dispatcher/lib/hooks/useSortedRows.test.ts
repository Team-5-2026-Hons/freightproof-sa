import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { readSortValue, sortRows, useSortedRows } from './useSortedRows'

interface Row {
  name: string | null
  rate: number | null
}

const ROWS: Row[] = [
  { name: 'Bravo', rate: 0.5 },
  { name: null, rate: null },
  { name: 'Alpha', rate: 0.9 },
]

describe('sortRows', () => {
  it('sorts ascending with no data last', () => {
    const sorted = sortRows(ROWS, { key: 'rate', dir: 'asc' }, readSortValue)

    expect(sorted.map((row) => row.rate)).toEqual([0.5, 0.9, null])
  })

  it('keeps no data last when descending, never on top', () => {
    const sorted = sortRows(ROWS, { key: 'rate', dir: 'desc' }, readSortValue)

    expect(sorted.map((row) => row.rate)).toEqual([0.9, 0.5, null])
  })

  it('sorts names alphabetically with missing names last', () => {
    const sorted = sortRows(ROWS, { key: 'name', dir: 'asc' }, readSortValue)

    expect(sorted.map((row) => row.name)).toEqual(['Alpha', 'Bravo', null])
  })

  it('does not mutate the rows it was given', () => {
    const before = [...ROWS]

    sortRows(ROWS, { key: 'name', dir: 'asc' }, readSortValue)

    expect(ROWS).toEqual(before)
  })
})

describe('useSortedRows', () => {
  it('flips direction on the sorted column and starts a new column ascending', () => {
    const { result } = renderHook(() => useSortedRows(ROWS, { key: 'name', dir: 'asc' }))

    act(() => result.current.onSort('name'))
    expect(result.current.sort).toEqual({ key: 'name', dir: 'desc' })
    expect(result.current.rows.map((row) => row.name)).toEqual(['Bravo', 'Alpha', null])

    act(() => result.current.onSort('rate'))
    expect(result.current.sort).toEqual({ key: 'rate', dir: 'asc' })
  })
})
