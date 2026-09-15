import { describe, expect, it } from 'vitest'

import {
  BOUNDARY_NEARBY_METRES,
  COMPARISON_MAP_INTERACTION,
  boundaryDistanceMetres,
  boundaryIsNearby,
  comparisonBounds,
  markerIconHtml,
} from '../LocationComparisonMap'
import { haversineMetres, type Coords } from '@/lib/phase/geo'
import type { LocationEvidence } from '@/lib/phase/location-evidence'

// Leaflet is never mounted here (per the brief: jsdom has no real tile/canvas stack to
// exercise it against): only the pure helpers this component exports are tested, the
// same "pure logic exported and tested against fakes" style as GeofenceMap.test.tsx.

const DRIVER_COORDS = { lat: -33.9249, lng: 18.4241 }
const TRACKER_COORDS = { lat: -33.9260, lng: 18.4300 }

// Mirrors geo.ts's EARTH_RADIUS_METRES (not imported: it is a private module constant
// there). A pure north/south offset with no longitude change makes haversineMetres
// return exactly this radius times the latitude delta in radians (asin(sin(x)) is x
// itself for the tiny angles involved), so this lets a test target a specific metres
// value directly instead of searching for one.
const EARTH_RADIUS_METRES_FOR_TEST = 6_371_008.8

function northOf(coords: Coords, metres: number): Coords {
  const deltaDeg = (metres / EARTH_RADIUS_METRES_FOR_TEST) * (180 / Math.PI)
  return { lat: coords.lat + deltaDeg, lng: coords.lng }
}

// Roughly 1,400 km north of the Cape Town fixes above (great-circle, since only the
// latitude differs): far past BOUNDARY_NEARBY_METRES from either recorded fix, standing
// in for the brief's "fix 1,400 km from its precinct" case.
const FAR_BOUNDARY_COORDS = northOf(DRIVER_COORDS, 1_400_000)

function makeEvidence(overrides: Partial<LocationEvidence> = {}): LocationEvidence {
  return {
    driverFix: {
      source: 'driver_phone',
      label: 'Driver phone',
      coords: DRIVER_COORDS,
      capturedAt: '2026-01-01T10:00:00Z',
      captureNote: null,
    },
    trackerFix: {
      source: 'horse_tracker',
      label: 'Horse tracker',
      coords: TRACKER_COORDS,
      capturedAt: null,
      captureNote: 'Captured within the corroboration window of the driver capture',
    },
    separationMetres: 650,
    verdict: 'within_tolerance',
    boundary: null,
    ...overrides,
  }
}

/** Type guard so tests can assert on BoundsExtent-shaped fields without an `as` cast. */
function isBoundsExtent(extent: unknown): extent is { south: number; west: number; north: number; east: number } {
  return extent !== null && typeof extent === 'object' && 'south' in extent
}

describe('comparisonBounds', () => {
  it('returns a box spanning both fixes', () => {
    const extent = comparisonBounds(makeEvidence())

    expect(isBoundsExtent(extent)).toBe(true)
    if (!isBoundsExtent(extent)) throw new Error('unreachable')

    expect(extent.south).toBeCloseTo(Math.min(DRIVER_COORDS.lat, TRACKER_COORDS.lat))
    expect(extent.north).toBeCloseTo(Math.max(DRIVER_COORDS.lat, TRACKER_COORDS.lat))
    expect(extent.west).toBeCloseTo(Math.min(DRIVER_COORDS.lng, TRACKER_COORDS.lng))
    expect(extent.east).toBeCloseTo(Math.max(DRIVER_COORDS.lng, TRACKER_COORDS.lng))
  })

  it('extends the box past both fixes when the boundary circle is the larger extent', () => {
    // A boundary centred on the driver fix with a radius many times the driver/tracker
    // separation must widen the box well past where the two fixes alone would put it;
    // this is the case a fit-bounds computed only from driverFix/trackerFix would get
    // wrong by clipping the boundary circle's stroke off-screen.
    const evidence = makeEvidence({
      boundary: {
        coords: DRIVER_COORDS,
        radiusMetres: 5_000,
        precinctName: 'Cape Town DC',
        provenance: 'current_reference_only',
      },
    })
    const fixesOnly = comparisonBounds(makeEvidence())
    const withBoundary = comparisonBounds(evidence)

    expect(isBoundsExtent(fixesOnly)).toBe(true)
    expect(isBoundsExtent(withBoundary)).toBe(true)
    if (!isBoundsExtent(fixesOnly) || !isBoundsExtent(withBoundary)) throw new Error('unreachable')

    expect(withBoundary.south).toBeLessThan(fixesOnly.south)
    expect(withBoundary.north).toBeGreaterThan(fixesOnly.north)
    expect(withBoundary.west).toBeLessThan(fixesOnly.west)
    expect(withBoundary.east).toBeGreaterThan(fixesOnly.east)
  })

  it('centres on a single fix with no boundary instead of fitting a zero-area box', () => {
    const extent = comparisonBounds(makeEvidence({ trackerFix: null, separationMetres: null }))

    expect(extent).not.toBeNull()
    expect(extent).toHaveProperty('center')
    if (extent === null || !('center' in extent)) throw new Error('unreachable')
    expect(extent.center).toEqual(DRIVER_COORDS)
  })

  it('returns a non-degenerate box for coincident fixes, not a single point', () => {
    const evidence = makeEvidence({
      trackerFix: {
        source: 'horse_tracker',
        label: 'Horse tracker',
        coords: DRIVER_COORDS,
        capturedAt: null,
        captureNote: 'Captured within the corroboration window of the driver capture',
      },
      separationMetres: 0,
    })
    const extent = comparisonBounds(evidence)

    expect(isBoundsExtent(extent)).toBe(true)
    if (!isBoundsExtent(extent)) throw new Error('unreachable')
    // "Non-degenerate": Leaflet's fitBounds on south===north / west===east zooms to its
    // own maximum rather than anything sensible, so the box must have real extent.
    expect(extent.north).toBeGreaterThan(extent.south)
    expect(extent.east).toBeGreaterThan(extent.west)
  })

  it('returns null when there is no fix and no boundary to draw at all', () => {
    const extent = comparisonBounds(makeEvidence({ driverFix: null, trackerFix: null, separationMetres: null }))

    expect(extent).toBeNull()
  })

  it('ignores a fix with non-finite coordinates rather than propagating NaN', () => {
    const evidence = makeEvidence({
      driverFix: {
        source: 'driver_phone',
        label: 'Driver phone',
        coords: { lat: NaN, lng: NaN },
        capturedAt: '2026-01-01T10:00:00Z',
        captureNote: null,
      },
      trackerFix: null,
      separationMetres: null,
    })
    const extent = comparisonBounds(evidence)

    expect(extent).toBeNull()
  })

  it("excludes a boundary far from every fix from the 'fixes' frame", () => {
    const evidence = makeEvidence({
      boundary: {
        coords: FAR_BOUNDARY_COORDS,
        radiusMetres: 500,
        precinctName: 'Johannesburg DC',
        provenance: 'current_reference_only',
      },
    })

    const withFarBoundary = comparisonBounds(evidence, 'fixes')
    const fixesOnly = comparisonBounds(makeEvidence(), 'fixes')

    expect(withFarBoundary).toEqual(fixesOnly)
  })

  it("includes a boundary near the fixes in the 'fixes' frame", () => {
    const evidence = makeEvidence({
      boundary: {
        coords: DRIVER_COORDS,
        radiusMetres: 5_000,
        precinctName: 'Cape Town DC',
        provenance: 'current_reference_only',
      },
    })

    const withNearBoundary = comparisonBounds(evidence, 'fixes')
    const fixesOnly = comparisonBounds(makeEvidence(), 'fixes')

    expect(isBoundsExtent(withNearBoundary)).toBe(true)
    expect(isBoundsExtent(fixesOnly)).toBe(true)
    if (!isBoundsExtent(withNearBoundary) || !isBoundsExtent(fixesOnly)) throw new Error('unreachable')
    expect(withNearBoundary.south).toBeLessThan(fixesOnly.south)
    expect(withNearBoundary.north).toBeGreaterThan(fixesOnly.north)
  })

  it("'precinct' frame returns only the boundary circle box, ignoring the fixes", () => {
    const boundary = {
      coords: DRIVER_COORDS,
      radiusMetres: 5_000,
      precinctName: 'Cape Town DC',
      provenance: 'current_reference_only' as const,
    }
    const evidence = makeEvidence({ boundary })
    const noFixesEvidence = makeEvidence({ driverFix: null, trackerFix: null, separationMetres: null, boundary })

    const precinctExtent = comparisonBounds(evidence, 'precinct')
    // The no-fix fallback for the 'fixes' target already returns just the boundary
    // circle's own box (see the next test), so it is the same box the 'precinct' target
    // must return: this checks the two agree without duplicating the box maths here.
    const circleOnlyExtent = comparisonBounds(noFixesEvidence, 'fixes')

    expect(precinctExtent).toEqual(circleOnlyExtent)
  })

  it("'precinct' frame returns null when there is no boundary", () => {
    expect(comparisonBounds(makeEvidence(), 'precinct')).toBeNull()
  })

  it('still returns the boundary circle box for a far boundary when there are no fixes at all', () => {
    const evidence = makeEvidence({
      driverFix: null,
      trackerFix: null,
      separationMetres: null,
      boundary: {
        coords: FAR_BOUNDARY_COORDS,
        radiusMetres: 500,
        precinctName: 'Johannesburg DC',
        provenance: 'current_reference_only',
      },
    })

    const extent = comparisonBounds(evidence, 'fixes')

    expect(isBoundsExtent(extent)).toBe(true)
    if (!isBoundsExtent(extent)) throw new Error('unreachable')
    expect(extent.south).toBeLessThan(FAR_BOUNDARY_COORDS.lat)
    expect(extent.north).toBeGreaterThan(FAR_BOUNDARY_COORDS.lat)
  })
})

describe('boundaryDistanceMetres', () => {
  it('measures from the boundary centre to the nearest of the two fixes', () => {
    const boundaryCentre = northOf(TRACKER_COORDS, 200) // closer to the tracker than to the driver
    const evidence = makeEvidence({
      boundary: {
        coords: boundaryCentre,
        radiusMetres: 150,
        precinctName: 'Cape Town DC',
        provenance: 'current_reference_only',
      },
    })

    const distance = boundaryDistanceMetres(evidence)

    expect(distance).not.toBeNull()
    if (distance === null) throw new Error('unreachable')
    expect(distance).toBeCloseTo(haversineMetres(boundaryCentre, TRACKER_COORDS), 6)
    expect(distance).toBeLessThan(haversineMetres(boundaryCentre, DRIVER_COORDS))
  })

  it('returns null when there is no boundary', () => {
    expect(boundaryDistanceMetres(makeEvidence({ boundary: null }))).toBeNull()
  })

  it('returns null when there is a boundary but no valid fix', () => {
    const evidence = makeEvidence({
      driverFix: null,
      trackerFix: null,
      separationMetres: null,
      boundary: {
        coords: DRIVER_COORDS,
        radiusMetres: 150,
        precinctName: 'Cape Town DC',
        provenance: 'current_reference_only',
      },
    })

    expect(boundaryDistanceMetres(evidence)).toBeNull()
  })
})

describe('boundaryIsNearby', () => {
  it(`is true at ${BOUNDARY_NEARBY_METRES - 1} m from the nearest fix`, () => {
    const evidence = makeEvidence({
      trackerFix: null,
      separationMetres: null,
      boundary: {
        coords: northOf(DRIVER_COORDS, BOUNDARY_NEARBY_METRES - 1),
        radiusMetres: 150,
        precinctName: 'Cape Town DC',
        provenance: 'current_reference_only',
      },
    })

    expect(boundaryIsNearby(evidence)).toBe(true)
  })

  it(`is false at ${BOUNDARY_NEARBY_METRES + 1} m from the nearest fix`, () => {
    const evidence = makeEvidence({
      trackerFix: null,
      separationMetres: null,
      boundary: {
        coords: northOf(DRIVER_COORDS, BOUNDARY_NEARBY_METRES + 1),
        radiusMetres: 150,
        precinctName: 'Cape Town DC',
        provenance: 'current_reference_only',
      },
    })

    expect(boundaryIsNearby(evidence)).toBe(false)
  })
})

describe('COMPARISON_MAP_INTERACTION', () => {
  // Leaflet is never mounted in this file (see the top-of-file comment), so this
  // constant — spread into `L.map(...)` in the component itself — is the only surface
  // of the scroll-wheel-zoom behaviour a jsdom test can reach at all; a live map's real
  // wheel-event handling is a browser-check concern, not a unit-test one.
  it('enables scroll-wheel zoom, unlike the embedded (non-modal) GeofenceMap', () => {
    expect(COMPARISON_MAP_INTERACTION.scrollWheelZoom).toBe(true)
  })
})

describe('markerIconHtml', () => {
  it('includes the driver phone label and a rounded (circular) shape class', () => {
    const html = markerIconHtml('driver_phone')

    expect(html).toContain('Driver phone')
    expect(html).toContain('rounded-full')
  })

  it('includes the horse tracker label and a shape class distinct from the driver marker', () => {
    const html = markerIconHtml('horse_tracker')

    expect(html).toContain('Horse tracker')
    expect(html).not.toContain('rounded-full')
  })
})
