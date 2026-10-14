import { describe, expect, it } from 'vitest'

import { DEFAULT_DRIVER_SORT, defaultDriverSortDirection, isDriverSortKey, sortDrivers } from './sort'
import type { Driver } from '@shared/lib/types/driver'

function driver(id: string, overrides: Partial<Driver> = {}): Driver {
  return {
    id: id as Driver['id'],
    organization_id: 'org',
    full_name: `Driver ${id}`,
    id_number: '8001015009087',
    phone_number: '0821234567',
    license_number: `DRV-${id}`,
    license_expiry: '2027-01-01',
    is_active: true,
    idvs_status: 'verified',
    idvs_last_verified_at: null,
    created_at: '2026-10-01T08:00:00Z',
    updated_at: '2026-10-01T08:00:00Z',
    ...overrides,
  }
}

const ids = (drivers: Driver[]): string[] => drivers.map(d => d.id)

describe('sortDrivers', () => {
  it('sorts names A to Z and back, ignoring case', () => {
    const drivers = [driver('a', { full_name: 'thandi' }), driver('b', { full_name: 'Aisha' }), driver('c', { full_name: 'Moses' })]

    expect(ids(sortDrivers(drivers, { key: 'name', dir: 'asc' }))).toEqual(['b', 'c', 'a'])
    expect(ids(sortDrivers(drivers, { key: 'name', dir: 'desc' }))).toEqual(['a', 'c', 'b'])
  })

  it('sorts by when the driver was added, newest first by default', () => {
    const drivers = [driver('old', { created_at: '2026-01-01T00:00:00Z' }), driver('new', { created_at: '2026-10-01T00:00:00Z' })]

    expect(DEFAULT_DRIVER_SORT).toEqual({ key: 'added', dir: 'desc' })
    expect(ids(sortDrivers(drivers, DEFAULT_DRIVER_SORT))).toEqual(['new', 'old'])
    expect(ids(sortDrivers(drivers, { key: 'added', dir: 'asc' }))).toEqual(['old', 'new'])
  })

  it('sorts licence expiry soonest first, with no expiry last in both directions', () => {
    const drivers = [
      driver('none', { license_expiry: null }),
      driver('late', { license_expiry: '2028-01-01' }),
      driver('soon', { license_expiry: '2026-11-01' }),
    ]

    expect(ids(sortDrivers(drivers, { key: 'expiry', dir: 'asc' }))).toEqual(['soon', 'late', 'none'])
    expect(ids(sortDrivers(drivers, { key: 'expiry', dir: 'desc' }))).toEqual(['late', 'soon', 'none'])
  })

  it('puts active drivers first when sorting status ascending', () => {
    const drivers = [driver('off', { is_active: false }), driver('on', { is_active: true })]

    expect(ids(sortDrivers(drivers, { key: 'status', dir: 'asc' }))).toEqual(['on', 'off'])
    expect(ids(sortDrivers(drivers, { key: 'status', dir: 'desc' }))).toEqual(['off', 'on'])
  })

  it('breaks ties by creation time then id, so equal rows never shuffle', () => {
    const drivers = [
      driver('z', { full_name: 'Same', created_at: '2026-10-02T00:00:00Z' }),
      driver('y', { full_name: 'Same', created_at: '2026-10-01T00:00:00Z' }),
      driver('x', { full_name: 'Same', created_at: '2026-10-01T00:00:00Z' }),
    ]

    expect(ids(sortDrivers(drivers, { key: 'name', dir: 'asc' }))).toEqual(['x', 'y', 'z'])
    expect(ids(sortDrivers(drivers, { key: 'name', dir: 'desc' }))).toEqual(['x', 'y', 'z'])
  })

  it('returns a new array and leaves the input untouched', () => {
    const drivers = [driver('b', { full_name: 'B' }), driver('a', { full_name: 'A' })]
    const before = ids(drivers)

    const sorted = sortDrivers(drivers, { key: 'name', dir: 'asc' })

    expect(sorted).not.toBe(drivers)
    expect(ids(drivers)).toEqual(before)
  })
})

describe('driver sort keys', () => {
  it('recognises only the sortable column ids and picks each column a sensible first direction', () => {
    for (const key of ['name', 'expiry', 'status', 'added']) expect(isDriverSortKey(key)).toBe(true)
    expect(isDriverSortKey('phone')).toBe(false)
    expect(defaultDriverSortDirection('added')).toBe('desc')
    expect(['name', 'expiry', 'status'].map(key => defaultDriverSortDirection(key as 'name'))).toEqual(['asc', 'asc', 'asc'])
  })
})
