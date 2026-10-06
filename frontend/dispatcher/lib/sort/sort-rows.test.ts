import { describe, expect, it } from 'vitest'

import { compareText, sortRows, toggleSort, type SortValue } from './sort-rows'

interface Row { id: string; name: string | null; score: number | null }

const valueOf = (row: Row, key: 'name' | 'score'): SortValue => row[key]
const ids = (rows: Row[]): string[] => rows.map(r => r.id)
const row = (id: string, name: string | null, score: number | null): Row => ({ id, name, score })

describe('sortRows', () => {
  it('orders numbers numerically and text naturally, in both directions', () => {
    const rows = [row('a', 'FP-10', 10), row('b', 'FP-9', 9), row('c', 'fp-100', 100)]

    expect(ids(sortRows(rows, { key: 'score', dir: 'asc' }, valueOf))).toEqual(['b', 'a', 'c'])
    expect(ids(sortRows(rows, { key: 'score', dir: 'desc' }, valueOf))).toEqual(['c', 'a', 'b'])
    // Natural order: FP-9 before FP-10 before fp-100, and case does not matter.
    expect(ids(sortRows(rows, { key: 'name', dir: 'asc' }, valueOf))).toEqual(['b', 'a', 'c'])
  })

  it('puts "no data" last whichever way the column runs', () => {
    const rows = [row('none', null, null), row('low', 'a', 1), row('high', 'b', 9)]

    expect(ids(sortRows(rows, { key: 'score', dir: 'asc' }, valueOf))).toEqual(['low', 'high', 'none'])
    expect(ids(sortRows(rows, { key: 'score', dir: 'desc' }, valueOf))).toEqual(['high', 'low', 'none'])
  })

  it('treats a number that is not a real number as no data, never letting NaN scramble the order', () => {
    const rows = [row('bad', 'x', Number.NaN), row('two', 'x', 2), row('one', 'x', 1)]

    expect(ids(sortRows(rows, { key: 'score', dir: 'asc' }, valueOf))).toEqual(['one', 'two', 'bad'])
    expect(ids(sortRows(rows, { key: 'score', dir: 'desc' }, valueOf))).toEqual(['two', 'one', 'bad'])
  })

  it('breaks ties with the tie-break, in the same order whichever way the column runs', () => {
    const rows = [row('z', 'same', 1), row('y', 'same', 1), row('x', 'same', 1)]
    const byId = (a: Row, b: Row): number => compareText(a.id, b.id)

    expect(ids(sortRows(rows, { key: 'name', dir: 'asc' }, valueOf, byId))).toEqual(['x', 'y', 'z'])
    expect(ids(sortRows(rows, { key: 'name', dir: 'desc' }, valueOf, byId))).toEqual(['x', 'y', 'z'])
  })

  it('keeps the input order for ties when there is no tie-break', () => {
    const rows = [row('z', 'same', 1), row('y', 'same', 1), row('x', 'same', 1)]

    expect(ids(sortRows(rows, { key: 'name', dir: 'asc' }, valueOf))).toEqual(['z', 'y', 'x'])
  })

  it('returns a new array and leaves the input untouched', () => {
    const rows = [row('b', 'b', 2), row('a', 'a', 1)]
    const before = ids(rows)

    const sorted = sortRows(rows, { key: 'name', dir: 'asc' }, valueOf)

    expect(sorted).not.toBe(rows)
    expect(ids(rows)).toEqual(before)
  })
})

describe('toggleSort', () => {
  const firstDir = (key: 'date' | 'name'): 'asc' | 'desc' => (key === 'date' ? 'desc' : 'asc')

  it('starts a new column in the direction that suits it', () => {
    expect(toggleSort(undefined, 'date', firstDir)).toEqual({ key: 'date', dir: 'desc' })
    expect(toggleSort({ key: 'date', dir: 'asc' }, 'name', firstDir)).toEqual({ key: 'name', dir: 'asc' })
  })

  it('flips the direction when the sorted column is clicked again', () => {
    expect(toggleSort({ key: 'name', dir: 'asc' }, 'name', firstDir)).toEqual({ key: 'name', dir: 'desc' })
    expect(toggleSort({ key: 'name', dir: 'desc' }, 'name', firstDir)).toEqual({ key: 'name', dir: 'asc' })
  })
})
