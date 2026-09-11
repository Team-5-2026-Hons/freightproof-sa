'use client'

import { useCallback, useMemo, useState } from 'react'

export type SortDir = 'asc' | 'desc'
export type SortValue = string | number | null

export interface SortState<T extends object> {
  key: keyof T
  dir: SortDir
}

export interface SortedRows<T extends object> {
  rows: T[]
  sort: SortState<T>
  onSort: (key: keyof T) => void
}

/** A column's own value when it is a plain string or number; anything else sorts as
 *  no data. Tables with composite columns pass their own accessor instead. */
export function readSortValue<T extends object>(row: T, key: keyof T): SortValue {
  const value = row[key]
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function compare(left: string | number, right: string | number): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right
  return String(left).localeCompare(String(right))
}

/** Sorted copy of `rows`. No data (null) sorts LAST in both directions: "no
 *  observations" is neither the best nor the worst value, so it must never top a
 *  column. */
export function sortRows<T extends object>(
  rows: readonly T[],
  sort: SortState<T>,
  sortValue: (row: T, key: keyof T) => SortValue,
): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = sortValue(a, sort.key)
    const right = sortValue(b, sort.key)
    if (left === null || right === null) {
      if (left === right) return 0
      return left === null ? 1 : -1
    }
    return compare(left, right) * sign
  })
}

/** Client-side sort state for a DataTable: clicking the sorted column flips its
 *  direction, clicking another column sorts it ascending. */
export function useSortedRows<T extends object>(
  rows: readonly T[],
  initial: SortState<T>,
  sortValue: (row: T, key: keyof T) => SortValue = readSortValue,
): SortedRows<T> {
  const [sort, setSort] = useState<SortState<T>>(initial)

  const sorted = useMemo(() => sortRows(rows, sort, sortValue), [rows, sort, sortValue])

  const onSort = useCallback((key: keyof T) => {
    setSort((current) => (
      current.key === key
        ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' }
    ))
  }, [])

  return { rows: sorted, sort, onSort }
}
