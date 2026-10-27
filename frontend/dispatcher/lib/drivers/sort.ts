import { compareText, sortRows, type Sort, type SortDir, type SortValue } from '@/lib/sort/sort-rows'
import type { Driver } from '@shared/lib/types/driver'

export const DRIVER_SORT_KEYS = ['name', 'expiry', 'status', 'added'] as const
export type DriverSortKey = typeof DRIVER_SORT_KEYS[number]
export type DriverSort = Sort<DriverSortKey>

export const DEFAULT_DRIVER_SORT: DriverSort = { key: 'added', dir: 'desc' }

export function isDriverSortKey(id: string): id is DriverSortKey {
  return (DRIVER_SORT_KEYS as readonly string[]).includes(id)
}

/** Time reads best newest first; a licence expiry soonest first (the one that needs action);
 *  names and status A to Z (active drivers first). */
export function defaultDriverSortDirection(key: DriverSortKey): SortDir {
  return key === 'added' ? 'desc' : 'asc'
}

function sortValue(driver: Driver, key: DriverSortKey): SortValue {
  switch (key) {
    case 'name': return driver.full_name
    case 'expiry': return driver.license_expiry ? Date.parse(driver.license_expiry) : null
    case 'status': return driver.is_active ? 0 : 1
    case 'added': return Date.parse(driver.created_at)
  }
}

const byCreationThenId = (a: Driver, b: Driver): number =>
  Date.parse(a.created_at) - Date.parse(b.created_at) || compareText(a.id, b.id)

/** A sorted copy of the drivers. */
export function sortDrivers(drivers: readonly Driver[], sort: DriverSort): Driver[] {
  return sortRows(drivers, sort, sortValue, byCreationThenId)
}
