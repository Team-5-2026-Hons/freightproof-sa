import { describe, expect, it } from 'vitest'
import { geofenceOffsetMetres, haversineMetres, separationMetres } from './geo'

// Cape Town CBD and a point ~1.11 km due north (0.01° of latitude).
const CAPE_TOWN = { lat: -33.9249, lng: 18.4241 }
const NORTH_1KM = { lat: -33.9149, lng: 18.4241 }

describe('haversineMetres', () => {
  it('returns zero for identical points', () => {
    expect(haversineMetres(CAPE_TOWN, CAPE_TOWN)).toBe(0)
  })

  it('measures 0.01 degrees of latitude as roughly 1.11 km', () => {
    expect(haversineMetres(CAPE_TOWN, NORTH_1KM)).toBeGreaterThan(1100)
    expect(haversineMetres(CAPE_TOWN, NORTH_1KM)).toBeLessThan(1120)
  })

  it('is symmetric', () => {
    expect(haversineMetres(CAPE_TOWN, NORTH_1KM)).toBeCloseTo(haversineMetres(NORTH_1KM, CAPE_TOWN), 6)
  })
})

describe('geofenceOffsetMetres', () => {
  it('is negative when the fix is inside the fence', () => {
    const offset = geofenceOffsetMetres(CAPE_TOWN, { ...CAPE_TOWN, radiusMetres: 500 })
    expect(offset).toBe(-500)
  })

  it('is positive when the fix is outside the fence', () => {
    const offset = geofenceOffsetMetres(NORTH_1KM, { ...CAPE_TOWN, radiusMetres: 500 })
    expect(offset).toBeGreaterThan(600)
  })

  it('returns null when the fix is missing, rather than defaulting to zero', () => {
    expect(geofenceOffsetMetres(null, { ...CAPE_TOWN, radiusMetres: 500 })).toBeNull()
  })

  it('returns null when the precinct is unknown', () => {
    expect(geofenceOffsetMetres(CAPE_TOWN, null)).toBeNull()
  })

  it('is exactly zero when the fix sits precisely on the boundary', () => {
    const radiusMetres = haversineMetres(CAPE_TOWN, NORTH_1KM)
    const offset = geofenceOffsetMetres(NORTH_1KM, { ...CAPE_TOWN, radiusMetres })
    expect(offset).toBe(0)
  })
})

describe('separationMetres', () => {
  it('returns null unless both fixes exist', () => {
    expect(separationMetres(CAPE_TOWN, null)).toBeNull()
    expect(separationMetres(null, CAPE_TOWN)).toBeNull()
  })

  it('measures the gap between two fixes', () => {
    expect(separationMetres(CAPE_TOWN, NORTH_1KM)).toBeGreaterThan(1100)
  })
})
