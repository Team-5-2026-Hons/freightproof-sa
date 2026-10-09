export type SortDir = 'asc' | 'desc'
/** What a column orders by. `null` means "no data": it sorts last, in both directions. */
export type SortValue = string | number | null
export interface Sort<K extends string> { key: K; dir: SortDir }

// Natural order, so "FP-9" comes before "FP-10", and case never splits "aisha" from "Aisha".
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

// A number that is not a real number (an unparseable date is NaN) is "no data", not a value that
// poisons every comparison it meets.
const normalise = (value: SortValue): SortValue => (typeof value === 'number' && !Number.isFinite(value) ? null : value)

/** A sorted copy of `rows`: the one ordering every table list uses.
 *
 *  - "No data" (`null`) is last whichever way the column runs, because it is neither the smallest
 *    nor the largest value and must never top a column.
 *  - Equal values fall to `tieBreak` (default: the input order), so rows never shuffle between
 *    refetches or when the direction flips.
 *
 *  Each list supplies only `valueOf`, what a column orders by, and its own `tieBreak`. */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: Sort<K>,
  valueOf: (row: T, key: K) => SortValue,
  tieBreak?: (a: T, b: T) => number,
): T[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const left = normalise(valueOf(a, sort.key))
    const right = normalise(valueOf(b, sort.key))
    if (left === null || right === null) {
      if (left !== right) return left === null ? 1 : -1
    } else if (left !== right) {
      const order = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right))
      if (order !== 0) return order * sign
    }
    return tieBreak ? tieBreak(a, b) : 0
  })
}

/** The state after a header click: the sorted column flips, any other column starts in the
 *  direction that suits it (a date newest first, a name A to Z). */
export function toggleSort<K extends string>(current: Sort<K> | undefined, key: K, firstDir: (key: K) => SortDir): Sort<K> {
  if (current?.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
  return { key, dir: firstDir(key) }
}

/** String ordering for tie-breaks and ids, kept here so every list compares text the same way. */
export function compareText(a: string, b: string): number {
  return collator.compare(a, b)
}
