import { describe, expect, it } from 'vitest'
import type { Precinct, PrecinctId } from '@shared/lib/types/precinct'
import type { OrganizationId } from '@shared/lib/types/precinct'
import { makePhase } from '@/components/domain/__tests__/testFixtures'
import {
  BOUNDARY_NEARBY_METRES,
  FIX_LABELS,
  TRACKER_CAPTURE_NOTE,
  VERDICT_LABELS,
  boundaryInDefaultFrame,
  hasAnyFix,
  hasComparison,
  hasLocationEvidence,
  isValidCoords,
  locationEvidenceForAssessment,
  locationEvidenceForPhase,
} from './location-evidence'

// Cape Town CBD and a point ~1.11 km due north: same fixture pair geo.test.ts uses,
// so a separation failure here and there points at the same underlying maths.
const CAPE_TOWN = { lat: -33.9249, lng: 18.4241 }
const NORTH_1KM = { lat: -33.9149, lng: 18.4241 }

const PRECINCT: Precinct = {
  id: 'precinct-1' as PrecinctId,
  name: 'Cape Town Depot, Gate 3',
  principal_organization_id: 'org-1' as OrganizationId,
  address: null,
  latitude: CAPE_TOWN.lat,
  longitude: CAPE_TOWN.lng,
  geofence_radius_metres: 200,
  is_shared: false,
  created_at: '2026-01-01T00:00:00Z',
}

describe('isValidCoords', () => {
  it('accepts finite in-range numbers', () => {
    expect(isValidCoords(-33.9249, 18.4241)).toBe(true)
  })

  it('rejects out-of-range latitude', () => {
    expect(isValidCoords(200, 18.4241)).toBe(false)
  })

  it('rejects out-of-range longitude', () => {
    expect(isValidCoords(-33.9249, -181)).toBe(false)
  })

  it('rejects NaN', () => {
    expect(isValidCoords(NaN, 18.4241)).toBe(false)
  })

  it('rejects null or undefined halves', () => {
    expect(isValidCoords(null, 18.4241)).toBe(false)
    expect(isValidCoords(-33.9249, undefined)).toBe(false)
  })
})

describe('locationEvidenceForPhase: fix presence', () => {
  it('populates both fixes when both are valid, with a positive separation and FIX_LABELS labels', () => {
    const phase = makePhase('departure', {
      driver_phone_lat: CAPE_TOWN.lat,
      driver_phone_lng: CAPE_TOWN.lng,
      horse_gps_lat: NORTH_1KM.lat,
      horse_gps_lng: NORTH_1KM.lng,
      status: 'completed',
    })

    const evidence = locationEvidenceForPhase(phase, undefined)

    expect(evidence.driverFix).not.toBeNull()
    expect(evidence.driverFix?.label).toBe(FIX_LABELS.driver_phone)
    expect(evidence.trackerFix).not.toBeNull()
    expect(evidence.trackerFix?.label).toBe(FIX_LABELS.horse_tracker)
    expect(evidence.separationMetres).not.toBeNull()
    expect(evidence.separationMetres!).toBeGreaterThan(1100)
  })

  it('leaves trackerFix null and separation null when only the driver fix is present', () => {
    const phase = makePhase('departure', {
      driver_phone_lat: CAPE_TOWN.lat,
      driver_phone_lng: CAPE_TOWN.lng,
      status: 'completed',
    })

    const evidence = locationEvidenceForPhase(phase, undefined)

    expect(evidence.driverFix).not.toBeNull()
    expect(evidence.trackerFix).toBeNull()
    expect(evidence.separationMetres).toBeNull()
  })

  it('leaves driverFix null and separation null when only the tracker fix is present', () => {
    const phase = makePhase('departure', {
      horse_gps_lat: CAPE_TOWN.lat,
      horse_gps_lng: CAPE_TOWN.lng,
      status: 'completed',
    })

    const evidence = locationEvidenceForPhase(phase, undefined)

    expect(evidence.driverFix).toBeNull()
    expect(evidence.trackerFix).not.toBeNull()
    expect(evidence.separationMetres).toBeNull()
  })

  it('leaves both fixes null when neither is recorded', () => {
    const phase = makePhase('departure', { status: 'completed' })

    const evidence = locationEvidenceForPhase(phase, undefined)

    expect(evidence.driverFix).toBeNull()
    expect(evidence.trackerFix).toBeNull()
    expect(evidence.separationMetres).toBeNull()
  })

  it('reports a real zero separation for coincident fixes, distinct from the null "no comparison" case', () => {
    const phase = makePhase('departure', {
      driver_phone_lat: CAPE_TOWN.lat,
      driver_phone_lng: CAPE_TOWN.lng,
      horse_gps_lat: CAPE_TOWN.lat,
      horse_gps_lng: CAPE_TOWN.lng,
      status: 'completed',
    })

    const evidence = locationEvidenceForPhase(phase, undefined)

    expect(evidence.separationMetres).toBe(0)
  })

  it('treats invalid coords as an absent fix rather than throwing', () => {
    const invalidLat = makePhase('departure', {
      driver_phone_lat: 200,
      driver_phone_lng: 18.4241,
      status: 'completed',
    })
    const invalidLatEvidence = locationEvidenceForPhase(invalidLat, undefined)
    expect(invalidLatEvidence.driverFix).toBeNull()

    const nanLat = makePhase('departure', {
      driver_phone_lat: NaN,
      driver_phone_lng: 18.4241,
      status: 'completed',
    })
    const nanLatEvidence = locationEvidenceForPhase(nanLat, undefined)
    expect(nanLatEvidence.driverFix).toBeNull()

    const invalidLng = makePhase('departure', {
      horse_gps_lat: -33.9249,
      horse_gps_lng: -181,
      status: 'completed',
    })
    const invalidLngEvidence = locationEvidenceForPhase(invalidLng, undefined)
    expect(invalidLngEvidence.trackerFix).toBeNull()
  })
})

describe('locationEvidenceForPhase: capture time', () => {
  it('carries driver_captured_at through to driverFix.capturedAt when present', () => {
    const phase = makePhase('departure', {
      driver_phone_lat: CAPE_TOWN.lat,
      driver_phone_lng: CAPE_TOWN.lng,
      driver_captured_at: '2026-03-01T08:00:00Z',
      status: 'completed',
    })

    const evidence = locationEvidenceForPhase(phase, undefined)

    expect(evidence.driverFix?.capturedAt).toBe('2026-03-01T08:00:00Z')
  })

  it('falls back to null when driver_captured_at is absent (undefined)', () => {
    const phase = makePhase('departure', {
      driver_phone_lat: CAPE_TOWN.lat,
      driver_phone_lng: CAPE_TOWN.lng,
      status: 'completed',
    })

    const evidence = locationEvidenceForPhase(phase, undefined)

    expect(evidence.driverFix?.capturedAt).toBeNull()
  })

  it('never assigns a tracker capture time, and always carries the corroboration-window note', () => {
    const phase = makePhase('departure', {
      horse_gps_lat: CAPE_TOWN.lat,
      horse_gps_lng: CAPE_TOWN.lng,
      status: 'completed',
    })

    const evidence = locationEvidenceForPhase(phase, undefined)

    expect(evidence.trackerFix?.capturedAt).toBeNull()
    expect(evidence.trackerFix?.captureNote).toBe(TRACKER_CAPTURE_NOTE)
  })
})

describe('locationEvidenceForPhase: verdict', () => {
  it('reads a stored true as within_tolerance', () => {
    const phase = makePhase('departure', { pulsit_geofence_confirmed: true, status: 'completed' })
    expect(locationEvidenceForPhase(phase, undefined).verdict).toBe('within_tolerance')
  })

  it('reads a stored false as outside_tolerance', () => {
    const phase = makePhase('departure', { pulsit_geofence_confirmed: false, status: 'completed' })
    expect(locationEvidenceForPhase(phase, undefined).verdict).toBe('outside_tolerance')
  })

  it('reads null on a completed phase as not_verified', () => {
    const phase = makePhase('departure', { pulsit_geofence_confirmed: null, status: 'completed' })
    expect(locationEvidenceForPhase(phase, undefined).verdict).toBe('not_verified')
  })

  it('reads null on a pending phase as not_checked_yet', () => {
    const phase = makePhase('departure', { pulsit_geofence_confirmed: null, status: 'pending' })
    expect(locationEvidenceForPhase(phase, undefined).verdict).toBe('not_checked_yet')
  })

  it('reads null on an in_progress phase as not_checked_yet', () => {
    const phase = makePhase('departure', { pulsit_geofence_confirmed: null, status: 'in_progress' })
    expect(locationEvidenceForPhase(phase, undefined).verdict).toBe('not_checked_yet')
  })

  it('reads null on an in_transit phase as no_verdict_for_phase', () => {
    const phase = makePhase('in_transit', { pulsit_geofence_confirmed: null, status: 'completed' })
    expect(locationEvidenceForPhase(phase, undefined).verdict).toBe('no_verdict_for_phase')
  })

  it('honours a stored false on in_transit (the stored fact wins over the phase-type expectation)', () => {
    const phase = makePhase('in_transit', { pulsit_geofence_confirmed: false, status: 'completed' })
    expect(locationEvidenceForPhase(phase, undefined).verdict).toBe('outside_tolerance')
  })

  it('exposes VERDICT_LABELS for every verdict value', () => {
    expect(VERDICT_LABELS.within_tolerance).toBe('Truck within precinct tolerance')
    expect(VERDICT_LABELS.outside_tolerance).toBe('Truck outside precinct tolerance')
    expect(VERDICT_LABELS.not_verified).toBe('Truck precinct check unavailable')
    expect(VERDICT_LABELS.not_checked_yet).toBe('Truck precinct check unavailable')
    expect(VERDICT_LABELS.no_verdict_for_phase).toBe('Truck precinct check unavailable for transit legs')
  })
})

describe('locationEvidenceForPhase: persisted assessment', () => {
  it('uses recorded proximity, geometry and tracker time without recomputing a legacy verdict', () => {
    const phase = makePhase('departure', {
      pulsit_geofence_confirmed: true,
      action_location_assessment: {
        schema_version: 1, policy_version: 'proximity-v1', evaluated_at: '2026-03-01T08:01:00Z',
        driver_lat: CAPE_TOWN.lat, driver_lng: CAPE_TOWN.lng, driver_captured_at: '2026-03-01T08:00:00Z', driver_accuracy_metres: 5,
        tracker_lat: NORTH_1KM.lat, tracker_lng: NORTH_1KM.lng, tracker_captured_at: '2026-03-01T08:00:10Z',
        separation_metres: 7_900, proximity: 'separated', reasons: [], max_separation_metres: 100, max_age_seconds: 60, max_skew_seconds: 30, max_phone_accuracy_metres: 50,
        expected_trip_stop_id: null, precinct_id: 'precinct-1', precinct_lat: CAPE_TOWN.lat, precinct_lng: CAPE_TOWN.lng, precinct_radius_metres: 200, precinct_tolerance_metres: 50,
        driver_in_precinct: true, truck_in_precinct: true,
      },
    })
    const evidence = locationEvidenceForPhase(phase, PRECINCT)
    expect(evidence.verdict).toBe('within_tolerance')
    expect(evidence.proximity).toBe('separated')
    expect(evidence.separationMetres).toBe(7_900)
    expect(evidence.trackerFix?.capturedAt).toBe('2026-03-01T08:00:10Z')
    expect(evidence.boundary?.provenance).toBe('recorded_snapshot')
    expect(evidence.boundary?.policyVersion).toBe('proximity-v1')
  })

  it('does not mix a partial recorded assessment with older phase coordinates', () => {
    const phase = makePhase('departure', {
      driver_phone_lat: CAPE_TOWN.lat, driver_phone_lng: CAPE_TOWN.lng, driver_captured_at: '2026-02-01T08:00:00Z',
      action_location_assessment: {
        schema_version: 1, policy_version: 'proximity-v1', evaluated_at: '2026-03-01T08:01:00Z',
        driver_lat: null, driver_lng: null, driver_captured_at: null, driver_accuracy_metres: null,
        tracker_lat: NORTH_1KM.lat, tracker_lng: NORTH_1KM.lng, tracker_captured_at: null,
        separation_metres: null, proximity: 'unverified', reasons: ['missing_phone'], max_separation_metres: 100, max_age_seconds: 60, max_skew_seconds: 30, max_phone_accuracy_metres: 50,
        expected_trip_stop_id: null, precinct_id: null, precinct_lat: null, precinct_lng: null, precinct_radius_metres: null, precinct_tolerance_metres: null,
        driver_in_precinct: null, truck_in_precinct: null,
      },
    })
    const evidence = locationEvidenceForPhase(phase, PRECINCT)
    expect(evidence.driverFix).toBeNull()
    // The persisted snapshot owns timing too: an absent capture remains absent rather
    // than silently acquiring a timestamp from an older phase column.
    expect(evidence.trackerFix?.capturedAt).toBeNull()
    // The current precinct is only a legacy reference. A partial snapshot must not
    // make it appear to be the geometry evaluated at the historical action.
    expect(evidence.boundary).toBeNull()
    expect(evidence.assessmentRecorded).toBe(true)
  })

  it('keeps a persisted null driver capture time unavailable instead of borrowing phase time', () => {
    const phase = makePhase('departure', {
      driver_phone_lat: NORTH_1KM.lat, driver_phone_lng: NORTH_1KM.lng, driver_captured_at: '2026-02-01T08:00:00Z',
      action_location_assessment: {
        schema_version: 1, policy_version: 'proximity-v1', evaluated_at: '2026-03-01T08:01:00Z',
        driver_lat: CAPE_TOWN.lat, driver_lng: CAPE_TOWN.lng, driver_captured_at: null, driver_accuracy_metres: null,
        tracker_lat: null, tracker_lng: null, tracker_captured_at: null,
        separation_metres: null, proximity: 'unverified', reasons: ['missing_time'], max_separation_metres: 100, max_age_seconds: 60, max_skew_seconds: 30, max_phone_accuracy_metres: 50,
        expected_trip_stop_id: null, precinct_id: null, precinct_lat: null, precinct_lng: null, precinct_radius_metres: null, precinct_tolerance_metres: null,
        driver_in_precinct: null, truck_in_precinct: null,
      },
    })
    expect(locationEvidenceForPhase(phase, PRECINCT).driverFix?.capturedAt).toBeNull()
  })
})

describe('locationEvidenceForPhase: boundary', () => {
  it('builds a current_reference_only boundary from the given precinct', () => {
    const phase = makePhase('departure', { status: 'completed' })

    const evidence = locationEvidenceForPhase(phase, PRECINCT)

    expect(evidence.boundary).toEqual({
      coords: { lat: PRECINCT.latitude, lng: PRECINCT.longitude },
      radiusMetres: PRECINCT.geofence_radius_metres,
      precinctName: PRECINCT.name,
      provenance: 'current_reference_only',
    })
  })

  it('is null when no precinct is known', () => {
    const phase = makePhase('departure', { status: 'completed' })
    expect(locationEvidenceForPhase(phase, undefined).boundary).toBeNull()
  })
})

describe('hasComparison / hasAnyFix', () => {
  it('hasComparison is true only when both fixes are present', () => {
    const both = locationEvidenceForPhase(
      makePhase('departure', {
        driver_phone_lat: CAPE_TOWN.lat,
        driver_phone_lng: CAPE_TOWN.lng,
        horse_gps_lat: NORTH_1KM.lat,
        horse_gps_lng: NORTH_1KM.lng,
        status: 'completed',
      }),
      undefined,
    )
    const driverOnly = locationEvidenceForPhase(
      makePhase('departure', { driver_phone_lat: CAPE_TOWN.lat, driver_phone_lng: CAPE_TOWN.lng, status: 'completed' }),
      undefined,
    )
    const neither = locationEvidenceForPhase(makePhase('departure', { status: 'completed' }), undefined)

    expect(hasComparison(both)).toBe(true)
    expect(hasComparison(driverOnly)).toBe(false)
    expect(hasComparison(neither)).toBe(false)
  })

  it('hasAnyFix is true when at least one fix is present, false when neither is', () => {
    const driverOnly = locationEvidenceForPhase(
      makePhase('departure', { driver_phone_lat: CAPE_TOWN.lat, driver_phone_lng: CAPE_TOWN.lng, status: 'completed' }),
      undefined,
    )
    const trackerOnly = locationEvidenceForPhase(
      makePhase('departure', { horse_gps_lat: CAPE_TOWN.lat, horse_gps_lng: CAPE_TOWN.lng, status: 'completed' }),
      undefined,
    )
    const neither = locationEvidenceForPhase(makePhase('departure', { status: 'completed' }), undefined)

    expect(hasAnyFix(driverOnly)).toBe(true)
    expect(hasAnyFix(trackerOnly)).toBe(true)
    expect(hasAnyFix(neither)).toBe(false)
  })
})

describe('hasLocationEvidence', () => {
  it('is true when a fix is recorded, even with no stored verdict', () => {
    const evidence = locationEvidenceForPhase(
      makePhase('loading', { driver_phone_lat: CAPE_TOWN.lat, driver_phone_lng: CAPE_TOWN.lng, status: 'completed' }),
      undefined,
    )
    expect(hasLocationEvidence(evidence)).toBe(true)
  })

  it('is true when a verdict is stored, even with no fix recorded', () => {
    const evidence = locationEvidenceForPhase(makePhase('loading', { pulsit_geofence_confirmed: false, status: 'completed' }), undefined)
    expect(hasLocationEvidence(evidence)).toBe(true)
  })

  it('is false when neither a fix nor a stored verdict is present', () => {
    const evidence = locationEvidenceForPhase(makePhase('loading', { status: 'pending' }), undefined)
    expect(hasLocationEvidence(evidence)).toBe(false)
  })

  it('is false for a completed phase with no fix and no stored verdict (not_verified)', () => {
    const evidence = locationEvidenceForPhase(makePhase('loading', { pulsit_geofence_confirmed: null, status: 'completed' }), undefined)
    expect(evidence.verdict).toBe('not_verified')
    expect(hasLocationEvidence(evidence)).toBe(false)
  })
})

describe('boundaryInDefaultFrame', () => {
  // ~1.11 km north of the fix: well inside BOUNDARY_NEARBY_METRES.
  const NEARBY_PRECINCT: Precinct = { ...PRECINCT, latitude: NORTH_1KM.lat, longitude: NORTH_1KM.lng }
  // ~12.6 degrees (~1,400 km) north: the brief's "fix a country away from its precinct" case.
  const FAR_PRECINCT: Precinct = { ...PRECINCT, latitude: CAPE_TOWN.lat + 12.6, longitude: CAPE_TOWN.lng }

  it('keeps a boundary that is within BOUNDARY_NEARBY_METRES of a fix', () => {
    const evidence = locationEvidenceForPhase(
      makePhase('activation', { driver_phone_lat: CAPE_TOWN.lat, driver_phone_lng: CAPE_TOWN.lng, status: 'completed' }),
      NEARBY_PRECINCT,
    )

    expect(boundaryInDefaultFrame(evidence)).toBe(evidence.boundary)
  })

  it(`drops a boundary farther than ${BOUNDARY_NEARBY_METRES} m from every fix`, () => {
    const evidence = locationEvidenceForPhase(
      makePhase('activation', { driver_phone_lat: CAPE_TOWN.lat, driver_phone_lng: CAPE_TOWN.lng, status: 'completed' }),
      FAR_PRECINCT,
    )

    expect(evidence.boundary).not.toBeNull()
    expect(boundaryInDefaultFrame(evidence)).toBeNull()
  })

  it('keeps a far boundary when there is no fix at all to prefer over it', () => {
    const evidence = locationEvidenceForPhase(makePhase('activation', { status: 'completed' }), FAR_PRECINCT)

    expect(hasAnyFix(evidence)).toBe(false)
    expect(boundaryInDefaultFrame(evidence)).toBe(evidence.boundary)
  })

  it('is null when no boundary is recorded', () => {
    const evidence = locationEvidenceForPhase(
      makePhase('activation', { driver_phone_lat: CAPE_TOWN.lat, driver_phone_lng: CAPE_TOWN.lng, status: 'completed' }),
      undefined,
    )

    expect(boundaryInDefaultFrame(evidence)).toBeNull()
  })
})

describe('locationEvidenceForAssessment: a snapshot that is not a phase', () => {
  // A driver's exception report or a checkpoint finding carries its own capture-time
  // comparison. There is no phase geofence verdict to honour for it, so the verdict is
  // the plain "unavailable" one — never the transit-leg or not-checked-yet explanations,
  // which describe a phase this capture is not.
  it('draws both fixes and the recorded proximity from the snapshot alone, with the plain unavailable verdict', () => {
    const evidence = locationEvidenceForAssessment({
      schema_version: 1, policy_version: 'proximity-v1', evaluated_at: '2026-03-01T08:01:00Z',
      driver_lat: CAPE_TOWN.lat, driver_lng: CAPE_TOWN.lng, driver_captured_at: '2026-03-01T08:00:00Z', driver_accuracy_metres: 5,
      tracker_lat: NORTH_1KM.lat, tracker_lng: NORTH_1KM.lng, tracker_captured_at: '2026-03-01T08:00:10Z',
      separation_metres: 1_000, proximity: 'separated', reasons: [], max_separation_metres: 100, max_age_seconds: 60, max_skew_seconds: 30, max_phone_accuracy_metres: 50,
      expected_trip_stop_id: null, precinct_id: null, precinct_lat: null, precinct_lng: null, precinct_radius_metres: null, precinct_tolerance_metres: null,
      driver_in_precinct: null, truck_in_precinct: null,
    }, PRECINCT)

    expect(evidence.driverFix?.coords).toEqual(CAPE_TOWN)
    expect(evidence.trackerFix?.coords).toEqual(NORTH_1KM)
    expect(evidence.separationMetres).toBe(1_000)
    expect(evidence.proximity).toBe('separated')
    expect(evidence.verdict).toBe('not_verified')
    expect(evidence.assessmentRecorded).toBe(true)
    // No recorded geometry means no boundary: the current precinct must not be
    // recast as what was evaluated at capture time.
    expect(evidence.boundary).toBeNull()
  })
})
