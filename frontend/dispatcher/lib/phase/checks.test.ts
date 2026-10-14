import { describe, expect, it } from 'vitest'
import { CROSS_DOCK_PHASE_PLAN, SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor, PhaseStatus } from '@shared/lib/types/phase'
import type { ActionLocationAssessment, ProximityVerdict } from '@shared/lib/types/action-location'
import { buildPhaseChecks, type CheckKey, type PhaseCheck, type PhaseChecksInput } from './checks'

// Single-leg plan sequence numbers: 0 trip_creation, 1 activation, 2 loading, 3 departure,
// 4 in_transit, 5 arrival, 6 unloading, 7 confirmation.
const SEQ = { creation: 0, activation: 1, loading: 2, departure: 3, transit: 4, arrival: 5, unloading: 6, confirmation: 7 } as const

type Patch = Partial<PhaseDescriptor>

/** Local on purpose: the module under test must not gain a helper that only tests use. */
function withPhases(plan: readonly PhaseDescriptor[], patches: Readonly<Record<number, Patch>>): PhaseDescriptor[] {
  return plan.map(phase => ({ ...phase, ...(patches[phase.sequence_number] ?? {}) }))
}

function assessment(proximity: ProximityVerdict): ActionLocationAssessment {
  return {
    schema_version: 1, policy_version: 'test', evaluated_at: '2026-10-13T08:00:00Z',
    driver_lat: null, driver_lng: null, driver_captured_at: null, driver_accuracy_metres: null,
    tracker_lat: null, tracker_lng: null, tracker_captured_at: null,
    separation_metres: null, proximity, reasons: [],
    max_separation_metres: 100, max_age_seconds: 60, max_skew_seconds: 30, max_phone_accuracy_metres: 50,
    expected_trip_stop_id: null, precinct_id: null, precinct_lat: null, precinct_lng: null,
    precinct_radius_metres: null, precinct_tolerance_metres: null,
    driver_in_precinct: null, truck_in_precinct: null,
  }
}

function checksFor(
  phases: readonly PhaseDescriptor[],
  seq: number,
  extra: Partial<Omit<PhaseChecksInput, 'phase' | 'allPhases'>> = {},
): PhaseCheck[] {
  const phase = phases.find(p => p.sequence_number === seq)!
  return buildPhaseChecks({
    phase, allPhases: phases,
    expectedCount: null, liveScannedCount: null, originScannedCount: null, precinct: undefined,
    ...extra,
  })
}

const COMPLETED: Patch = { status: 'completed', completed_at: '2026-10-13T08:00:00Z' }
const byKey = (checks: readonly PhaseCheck[], key: CheckKey): PhaseCheck | undefined => checks.find(c => c.key === key)

/** Every phase before `through` completed, so the next one is the plan's active phase. */
function walkTo(through: number, patches: Readonly<Record<number, Patch>> = {}, plan = SINGLE_LEG_PHASE_PLAN): PhaseDescriptor[] {
  const completed: Record<number, Patch> = {}
  for (let seq = 0; seq < through; seq += 1) completed[seq] = COMPLETED
  const merged: Record<number, Patch> = { ...completed }
  for (const [seq, patch] of Object.entries(patches)) merged[Number(seq)] = { ...merged[Number(seq)], ...patch }
  return withPhases(plan, merged)
}

describe('parcels (loading)', () => {
  const loaded = (scanned: number | null) =>
    walkTo(SEQ.loading + 1, { [SEQ.loading]: { parcel_count_origin: scanned } })

  it('passes when the scan equals the manifest', () => {
    const check = byKey(checksFor(loaded(7), SEQ.loading, { expectedCount: 7 }), 'parcels')

    expect(check?.result).toBe('pass')
    expect(check?.title).toBe('All parcels scanned')
  })

  it('flags a shortfall with a singular noun for one parcel', () => {
    const check = byKey(checksFor(loaded(6), SEQ.loading, { expectedCount: 7 }), 'parcels')

    expect(check?.result).toBe('flag')
    expect(check?.title).toBe('1 parcel not scanned')
  })

  it('pluralises a shortfall of two', () => {
    const check = byKey(checksFor(loaded(5), SEQ.loading, { expectedCount: 7 }), 'parcels')

    expect(check?.title).toBe('2 parcels not scanned')
  })

  it('flags an excess, singular and plural', () => {
    expect(byKey(checksFor(loaded(8), SEQ.loading, { expectedCount: 7 }), 'parcels')?.title).toBe('1 excess parcel scanned')
    expect(byKey(checksFor(loaded(9), SEQ.loading, { expectedCount: 7 }), 'parcels')?.title).toBe('2 excess parcels scanned')
    expect(byKey(checksFor(loaded(9), SEQ.loading, { expectedCount: 7 }), 'parcels')?.result).toBe('flag')
  })

  it('is not checked, never zero, when there is no manifest baseline', () => {
    const check = byKey(checksFor(loaded(7), SEQ.loading, { expectedCount: null }), 'parcels')

    expect(check?.result).toBe('not_checked')
  })

  it('is not checked when no scan was stamped at completion', () => {
    const check = byKey(checksFor(loaded(null), SEQ.loading, { expectedCount: 7 }), 'parcels')

    expect(check?.result).toBe('not_checked')
  })

  it('compares the stamped tally, not the live count, once resolved', () => {
    const check = byKey(checksFor(loaded(7), SEQ.loading, { expectedCount: 7, liveScannedCount: 3 }), 'parcels')

    expect(check?.result).toBe('pass')
  })
})

describe('parcels (unloading)', () => {
  const unloaded = walkTo(SEQ.unloading + 1)

  it('compares the live scanned-off count to the stop expectation', () => {
    expect(byKey(checksFor(unloaded, SEQ.unloading, { expectedCount: 7, liveScannedCount: 7 }), 'parcels')?.result).toBe('pass')
    expect(byKey(checksFor(unloaded, SEQ.unloading, { expectedCount: 7, liveScannedCount: 6 }), 'parcels')?.title).toBe('1 parcel not scanned')
  })

  it('is not checked when the stop has no baseline', () => {
    expect(byKey(checksFor(unloaded, SEQ.unloading, { expectedCount: null, liveScannedCount: 6 }), 'parcels')?.result).toBe('not_checked')
  })
})

describe('counts (confirmation)', () => {
  const confirmed = (destination: number | null) =>
    walkTo(SEQ.confirmation + 1, { [SEQ.confirmation]: { parcel_count_destination: destination, driver_visual_count: 99 } })

  it('passes when origin and destination agree', () => {
    const check = byKey(checksFor(confirmed(7), SEQ.confirmation, { originScannedCount: 7 }), 'counts')

    expect(check?.result).toBe('pass')
    expect(check?.title).toBe('Counts agree')
  })

  it('flags 7 out and 6 in as one parcel unaccounted for', () => {
    const check = byKey(checksFor(confirmed(6), SEQ.confirmation, { originScannedCount: 7 }), 'counts')

    expect(check?.result).toBe('flag')
    expect(check?.title).toBe('1 parcel unaccounted for')
  })

  it('pluralises two unaccounted parcels', () => {
    expect(byKey(checksFor(confirmed(5), SEQ.confirmation, { originScannedCount: 7 }), 'counts')?.title).toBe('2 parcels unaccounted for')
  })

  it('flags an excess at the destination, singular and plural', () => {
    expect(byKey(checksFor(confirmed(8), SEQ.confirmation, { originScannedCount: 7 }), 'counts')?.title).toBe('1 excess parcel scanned at destination')
    expect(byKey(checksFor(confirmed(9), SEQ.confirmation, { originScannedCount: 7 }), 'counts')?.title).toBe('2 excess parcels scanned at destination')
  })

  it('is not checked when either side is null, never zero', () => {
    expect(byKey(checksFor(confirmed(null), SEQ.confirmation, { originScannedCount: 7 }), 'counts')?.result).toBe('not_checked')
    expect(byKey(checksFor(confirmed(7), SEQ.confirmation, { originScannedCount: null }), 'counts')?.result).toBe('not_checked')
  })

  it("keeps the driver's blind count out of the verdict inputs", () => {
    const checks = checksFor(confirmed(7), SEQ.confirmation, { originScannedCount: 7 })

    expect(checks.map(c => c.key)).toEqual(['counts', 'truck_geofence'])
  })
})

describe('seal checks (arrival)', () => {
  const arrived = (patch: Patch, departure: Patch = { seal_number: 'FP-1001' }) =>
    walkTo(SEQ.arrival + 1, { [SEQ.departure]: departure, [SEQ.arrival]: patch })

  it('passes number and condition when the seal matches and is intact', () => {
    const checks = checksFor(arrived({ seal_number: 'FP-1001', seal_condition: 'intact' }), SEQ.arrival)

    expect(byKey(checks, 'seal_number')?.result).toBe('pass')
    expect(byKey(checks, 'seal_condition')?.result).toBe('pass')
  })

  it('flags two different numbers even with no exception (O8)', () => {
    const check = byKey(checksFor(arrived({ seal_number: 'FP-9999', seal_condition: 'intact' }), SEQ.arrival), 'seal_number')

    expect(check?.result).toBe('flag')
    expect(check?.detail).toContain('FP-1001')
    expect(check?.detail).toContain('FP-9999')
  })

  it.each(['damaged', 'missing'] as const)('flags a seal found %s', condition => {
    const check = byKey(checksFor(arrived({ seal_number: 'FP-1001', seal_condition: condition }), SEQ.arrival), 'seal_condition')

    expect(check?.result).toBe('flag')
    expect(check?.title).toBe(`Seal found ${condition}`)
  })

  it('does not check the condition when none was recorded', () => {
    const check = byKey(checksFor(arrived({ seal_number: 'FP-1001', seal_condition: null }), SEQ.arrival), 'seal_condition')

    expect(check?.result).toBe('not_checked')
  })

  it('does not compare numbers when the leg has no departure seal', () => {
    const check = byKey(checksFor(arrived({ seal_number: 'FP-1001', seal_condition: 'intact' }, { seal_number: null }), SEQ.arrival), 'seal_number')

    expect(check?.result).toBe('not_checked')
  })

  it('does not compare numbers when no seal was read at arrival', () => {
    const check = byKey(checksFor(arrived({ seal_number: null, seal_condition: 'missing' }), SEQ.arrival), 'seal_number')

    expect(check?.result).toBe('not_checked')
  })

  it("compares against the leg's own departure seal on a cross-dock trip (D40)", () => {
    // Each leg has its own seal; leg 2's arrival must compare against leg 2's, not leg 1's.
    const plan = walkTo(11, {
      3: { seal_number: 'FP-LEG1' },
      8: { seal_number: 'FP-LEG2' },
      10: { seal_number: 'FP-LEG2', seal_condition: 'intact' },
    }, CROSS_DOCK_PHASE_PLAN)

    expect(byKey(checksFor(plan, 10), 'seal_number')?.result).toBe('pass')
  })

  it('reports not_checked when the cross-dock leg has no departure seal of its own', () => {
    const plan = walkTo(11, {
      3: { seal_number: 'FP-LEG1' },
      8: { seal_number: null },
      10: { seal_number: 'FP-LEG1', seal_condition: 'intact' },
    }, CROSS_DOCK_PHASE_PLAN)

    expect(byKey(checksFor(plan, 10), 'seal_number')?.result).toBe('not_checked')
  })
})

describe('location: truck geofence (D43)', () => {
  const departed = (confirmed: boolean | null, extra: Patch = {}) =>
    walkTo(SEQ.departure + 1, { [SEQ.departure]: { pulsit_geofence_confirmed: confirmed, ...extra } })

  it('passes inside the precinct tolerance', () => {
    const check = byKey(checksFor(departed(true), SEQ.departure), 'truck_geofence')

    expect(check?.result).toBe('pass')
    expect(check?.title).toBe('Truck within precinct tolerance')
  })

  it('flags outside the precinct tolerance', () => {
    const check = byKey(checksFor(departed(false), SEQ.departure), 'truck_geofence')

    expect(check?.result).toBe('flag')
    expect(check?.title).toBe('Truck outside precinct tolerance')
  })

  it('is not checked when no verdict was stored', () => {
    const check = byKey(checksFor(departed(null), SEQ.departure), 'truck_geofence')

    expect(check?.result).toBe('not_checked')
    expect(check?.title).toBe('Truck precinct check unavailable')
  })

  it.each([SEQ.activation, SEQ.loading, SEQ.departure, SEQ.arrival, SEQ.unloading, SEQ.confirmation])(
    'runs for phase sequence %i', seq => {
      const checks = checksFor(walkTo(seq + 1, { [seq]: { pulsit_geofence_confirmed: true } }), seq)

      expect(byKey(checks, 'truck_geofence')?.result).toBe('pass')
    })
})

describe('location: driver proximity (D43)', () => {
  const departed = (patch: Patch) => walkTo(SEQ.departure + 1, { [SEQ.departure]: { pulsit_geofence_confirmed: true, ...patch } })

  it('passes within the limit', () => {
    const check = byKey(checksFor(departed({ action_location_assessment: assessment('within_limit') }), SEQ.departure), 'driver_proximity')

    expect(check?.result).toBe('pass')
    expect(check?.title).toBe('Driver with truck')
  })

  it('flags a separated driver', () => {
    const check = byKey(checksFor(departed({ action_location_assessment: assessment('separated') }), SEQ.departure), 'driver_proximity')

    expect(check?.result).toBe('flag')
    expect(check?.title).toBe('Driver separated from truck')
  })

  it('is not checked when the comparison was unverified', () => {
    const check = byKey(checksFor(departed({ action_location_assessment: assessment('unverified') }), SEQ.departure), 'driver_proximity')

    expect(check?.result).toBe('not_checked')
  })

  it('produces no proximity check at all when no assessment was recorded (legacy rows)', () => {
    const checks = checksFor(departed({ action_location_assessment: null }), SEQ.departure)

    expect(byKey(checks, 'driver_proximity')).toBeUndefined()
    expect(byKey(checks, 'truck_geofence')?.result).toBe('pass')
  })

  it('keeps the two location checks separate: a passing truck does not hide a separated driver', () => {
    const checks = checksFor(departed({ action_location_assessment: assessment('separated') }), SEQ.departure)

    expect(byKey(checks, 'truck_geofence')?.result).toBe('pass')
    expect(byKey(checks, 'driver_proximity')?.result).toBe('flag')
  })
})

describe('unresolved phases (D34)', () => {
  it('gives only a live "in progress" scan line while loading is running', () => {
    const checks = checksFor(walkTo(SEQ.loading), SEQ.loading, { expectedCount: 7, liveScannedCount: 3 })

    expect(checks).toHaveLength(1)
    expect(checks[0]).toMatchObject({ key: 'parcels', result: 'in_progress' })
    expect(checks[0].detail).toContain('3')
  })

  it('gives a live scan line while unloading is running', () => {
    const checks = checksFor(walkTo(SEQ.unloading), SEQ.unloading, { expectedCount: 7, liveScannedCount: 4 })

    expect(checks).toHaveLength(1)
    expect(checks[0]).toMatchObject({ key: 'parcels', result: 'in_progress' })
  })

  it('gives no scan line for a phase that is not the active one', () => {
    const plan = walkTo(SEQ.activation, {})

    expect(checksFor(plan, SEQ.loading, { expectedCount: 7, liveScannedCount: 3 })).toEqual([])
  })

  it('gives nothing when there is no live count yet', () => {
    expect(checksFor(walkTo(SEQ.loading), SEQ.loading, { expectedCount: 7, liveScannedCount: null })).toEqual([])
  })

  it.each([SEQ.activation, SEQ.departure, SEQ.arrival, SEQ.confirmation])(
    'asserts nothing for the unresolved phase at sequence %i', seq => {
      const checks = checksFor(walkTo(seq, { [seq]: { seal_number: 'FP-1', seal_condition: 'intact', pulsit_geofence_confirmed: true } }), seq)

      expect(checks.filter(c => c.result === 'pass' || c.result === 'flag')).toEqual([])
      expect(checks).toEqual([])
    })

  it('never passes or flags while a scan is live', () => {
    const checks = checksFor(walkTo(SEQ.loading), SEQ.loading, { expectedCount: 7, liveScannedCount: 9 })

    expect(checks.every(c => c.result === 'in_progress')).toBe(true)
  })
})

describe('overridden phases', () => {
  it('is a single "Checks bypassed" line, not checked', () => {
    const phases = walkTo(SEQ.loading + 1, { [SEQ.loading]: { status: 'overridden', parcel_count_origin: 1, pulsit_geofence_confirmed: false } })

    const checks = checksFor(phases, SEQ.loading, { expectedCount: 7 })

    expect(checks).toEqual([expect.objectContaining({ key: 'bypassed', result: 'not_checked', title: 'Checks bypassed' })])
  })
})

describe('in_transit (R2)', () => {
  const sealed = { [SEQ.departure]: { seal_number: 'FP-6390' } }

  it('shows the standing seal line, not_checked, while the leg is active', () => {
    const checks = checksFor(walkTo(SEQ.transit, sealed), SEQ.transit)

    expect(checks).toHaveLength(1)
    expect(checks[0]).toMatchObject({ key: 'seal_inspection', result: 'not_checked', title: 'Seal not inspected yet' })
    expect(checks[0].detail).toContain('FP-6390')
    expect(checks[0].detail).toContain('Arrival')
  })

  it('shows the same not_checked line for a resolved leg, even with a stored geofence verdict', () => {
    const phases = walkTo(SEQ.transit + 1, { ...sealed, [SEQ.transit]: { pulsit_geofence_confirmed: true } })

    const checks = checksFor(phases, SEQ.transit)

    expect(checks).toHaveLength(1)
    expect(checks[0]).toMatchObject({ key: 'seal_inspection', result: 'not_checked', title: 'Seal not inspected in transit' })
  })

  it('never produces a pass', () => {
    const states: PhaseStatus[] = ['pending', 'in_progress', 'completed', 'exception']
    for (const status of states) {
      const phases = walkTo(SEQ.transit, { [SEQ.transit]: { status } })

      expect(checksFor(phases, SEQ.transit).some(c => c.result === 'pass')).toBe(false)
    }
  })

  it('says nothing for a leg that has not started', () => {
    expect(checksFor(walkTo(SEQ.loading), SEQ.transit)).toEqual([])
  })

  it('omits the seal number from the line when the departure recorded none', () => {
    const checks = checksFor(walkTo(SEQ.transit), SEQ.transit)

    expect(checks[0].detail).not.toContain('null')
  })
})

describe('trip_creation', () => {
  it('has no checks', () => {
    expect(checksFor(walkTo(1, { 0: { status: 'completed' } }), SEQ.creation)).toEqual([])
  })
})
