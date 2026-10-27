export type SortDir = 'asc' | 'desc'
type SortScalar = string | number
/** What a column orders by. `null` means "no data": it sorts last, in both directions. A list is
 *  compared element by element, for a column that ranks by several things at once (severity, then
 *  title); the whole list flips with the direction, unlike the tie-break. */
export type SortValue = SortScalar | readonly SortScalar[] | null
export interface Sort<K extends string> { key: K; dir: SortDir }

const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true })

const normalise = (value: SortValue): SortValue => (typeof value === 'number' && !Number.isFinite(value) ? null : value)

const isList = (value: SortScalar | readonly SortScalar[]): value is readonly SortScalar[] => Array.isArray(value)

function compareScalars(left: SortScalar, right: SortScalar): number {
  return typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right))
}

function compareValues(left: SortScalar | readonly SortScalar[], right: SortScalar | readonly SortScalar[]): number {
  const a = isList(left) ? left : [left]
  const b = isList(right) ? right : [right]
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareScalars(a[i], b[i])
    if (order !== 0) return order
  }
  return a.length - b.length
}

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
    } else {
      const order = compareValues(left, right)
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
