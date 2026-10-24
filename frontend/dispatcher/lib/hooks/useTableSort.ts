'use client'

import { useCallback, useState } from 'react'
import type { TableSort } from '@/components/ui/Table'
import { toggleSort, type Sort, type SortDir } from '@/lib/sort/sort-rows'

interface TableSortOptions<K extends string> {
  /** The column ids that can sort; a click on anything else is ignored. */
  keys: readonly K[]
  firstDir: (key: K) => SortDir
}

export interface UseTableSort<K extends string, S extends Sort<K> | undefined> {
  sort: S
  /** The Table's own shape for the sorted column, or undefined while nothing is sorted. */
  tableSort: TableSort | undefined
  onSort: (columnId: string) => void
}

/** Sort state for a client-sorted table: remembers the column, flips it on a second click, and
 *  speaks the Table's `{ id, dir }` and column-id vocabulary so a page wires it with three props.
 *  Without `initial` the list stays in the order it arrived until a header is clicked. */
export function useTableSort<K extends string>(options: TableSortOptions<K> & { initial: Sort<K> }): UseTableSort<K, Sort<K>>
export function useTableSort<K extends string>(options: TableSortOptions<K> & { initial?: undefined }): UseTableSort<K, Sort<K> | undefined>
export function useTableSort<K extends string>({ keys, firstDir, initial }: TableSortOptions<K> & { initial?: Sort<K> }): UseTableSort<K, Sort<K> | undefined> {
  const [sort, setSort] = useState<Sort<K> | undefined>(initial)

  const onSort = useCallback((columnId: string): void => {
    const key = keys.find(candidate => candidate === columnId)
    if (key === undefined) return
    setSort(current => toggleSort(current, key, firstDir))
  }, [keys, firstDir])

  return { sort, tableSort: sort && { id: sort.key, dir: sort.dir }, onSort }
}
