import { describe, expect, it } from 'vitest'
import { mockPrecincts, mockTrips, TRIP_0035_ID, TRIP_0041_ID, TRIP_0043_ID } from '@shared/lib/mocks'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ConsignmentRead, Trip } from '@shared/lib/types/trip'
import { buildPhaseCardModel, type PhaseCardInput } from './card'

function tripFor(id: typeof TRIP_0035_ID | typeof TRIP_0041_ID | typeof TRIP_0043_ID): Trip {
  const trip = mockTrips.find(candidate => candidate.id === id)
  if (!trip) throw new Error(`fixture ${id} is missing`)
  return trip
}

function phaseOf(trip: Trip, type: PhaseDescriptor['phase_type']): PhaseDescriptor {
  const phase = trip.phases.find(candidate => candidate.phase_type === type)
  if (!phase) throw new Error(`${type} phase is missing`)
  return phase
}

function input(trip: Trip, phase: PhaseDescriptor, overrides: Partial<PhaseCardInput> = {}): PhaseCardInput {
  return { trip, phase, precincts: mockPrecincts, artifacts: [], exceptions: [], receipt: undefined, nowMs: Date.parse('2026-05-09T12:00:00Z'), ...overrides }
}

function scanning(trip: Trip, type: 'loading' | 'unloading', status: Trip['status']): Trip {
  const target = phaseOf(trip, type)
  const consignment = {
    id: 'c1', trip_id: trip.id, parcel_perfect_reference: 'PP', parcel_count_expected: 7, pickup_stop_id: target.trip_stop_id,
    delivery_stop_id: target.trip_stop_id, scanned_out_count: 3, scanned_in_count: 3,
  } as unknown as ConsignmentRead
  return {
    ...trip,
    status,
    closed_at: status === 'cancelled' ? '2026-05-09T09:00:00Z' : null,
    consignments: [consignment],
    phases: trip.phases.map(phase => phase.sequence_number >= target.sequence_number
      ? { ...phase, status: 'pending' as const, completed_at: null }
      : { ...phase, status: 'completed' as const, completed_at: phase.completed_at ?? '2026-05-09T08:00:00Z' }),
  }
}

describe('buildPhaseCardModel: a cancelled trip never shows a live scan line', () => {
  it.each(['loading', 'unloading'] as const)('suppresses the %s scan line when cancelled, and shows it on a running trip', type => {
    const base = tripFor(TRIP_0041_ID)
    const running = scanning(base, type, 'active')
    const cancelled = scanning(base, type, 'cancelled')

    const live = buildPhaseCardModel(input(running, phaseOf(running, type)))
    const dead = buildPhaseCardModel(input(cancelled, phaseOf(cancelled, type)))

    expect(live.checks.map(check => check.result)).toEqual(['in_progress'])
    expect(live.checkedZone).toBe('awaiting')
    expect(dead.checks).toEqual([])
    expect(dead.checkedZone).toBe('none')
  })
})

describe('buildPhaseCardModel', () => {
  it('gives trip_creation nothing to derive: no acts, checks or verdict', () => {
    const trip = tripFor(TRIP_0035_ID)

    const model = buildPhaseCardModel(input(trip, phaseOf(trip, 'trip_creation')))

    expect(model.acts).toEqual([])
    expect(model.checks).toEqual([])
    expect(model.verdict).toBeNull()
    expect(model.checkedZone).toBe('none')
  })

  it('shows a resolved phase its checks, a verdict and a body', () => {
    const trip = tripFor(TRIP_0035_ID)
    const departure = phaseOf(trip, 'departure')

    const model = buildPhaseCardModel(input(trip, departure))

    expect(model.isActive).toBe(false)
    expect(model.checkedZone).toBe('checks')
    expect(model.verdict).not.toBeNull()
    expect(model.hasBody).toBe(true)
    expect(model.acts.some(act => act.kind === 'completion')).toBe(true)
  })

  it('treats the lowest unresolved phase of a running trip as active, with expectations and no checks yet', () => {
    const trip = tripFor(TRIP_0041_ID)
    const transit = phaseOf(trip, 'in_transit')

    const model = buildPhaseCardModel(input(trip, transit))

    expect(model.isActive).toBe(true)
    expect(model.acts.map(act => act.kind)).toContain('expected')
    expect(model.checkedZone).toBe('checks')
    expect(model.checks.map(check => check.key)).toEqual(['seal_inspection'])
    expect(model.verdict?.outcome).toBe('in_progress')
  })

  it('says a not-yet-active phase checks nothing and has nothing to show', () => {
    const trip = tripFor(TRIP_0041_ID)
    const confirmation = phaseOf(trip, 'confirmation')

    const model = buildPhaseCardModel(input(trip, confirmation))

    expect(model.isActive).toBe(false)
    expect(model.acts).toEqual([])
    expect(model.checks).toEqual([])
    expect(model.checkedZone).toBe('none')
    expect(model.verdict).toBeNull()
    expect(model.hasBody).toBe(false)
  })

  it('awaits checks on the active phase of a running trip, and still offers the live scan count', () => {
    const base = tripFor(TRIP_0041_ID)
    const loading = phaseOf(base, 'loading')
    const trip: Trip = {
      ...base,
      phases: base.phases.map(phase => phase.sequence_number >= loading.sequence_number
        ? { ...phase, status: 'pending' as const, completed_at: null }
        : phase),
    }
    const open = phaseOf(trip, 'loading')

    const model = buildPhaseCardModel(input(trip, open))

    expect(model.checkedZone).toBe('awaiting')
    expect(model.verdict?.outcome).toBe('current')
  })

  it('never renders a live line for the unresolved phase of a cancelled trip: no checks, no verdict, no expected rows', () => {
    const base = tripFor(TRIP_0041_ID)
    const trip: Trip = {
      ...base,
      status: 'cancelled',
      closed_at: '2026-05-09T10:00:00Z',
      phases: base.phases.map(phase => ({ ...phase, status: phase.status === 'completed' ? phase.status : 'pending' as const })),
    }
    const transit = phaseOf(trip, 'in_transit')

    const model = buildPhaseCardModel(input(trip, transit))

    expect(model.checks).toEqual([])
    expect(model.checkedZone).toBe('none')
    expect(model.verdict).toBeNull()
    expect(model.acts.filter(act => act.kind === 'expected')).toEqual([])
    expect(model.hasBody).toBe(false)
  })

  it('makes an unreviewed exception on a closed phase an attention verdict with an amber node', () => {
    const trip = tripFor(TRIP_0035_ID)
    const loading = phaseOf(trip, 'loading')
    const exception = { ...trip.exceptions[0]!, phase_event_id: loading.phase_event_id, review_status: 'needs_review' as const }

    const model = buildPhaseCardModel(input(trip, loading, { exceptions: [exception] }))

    expect(model.verdict?.outcome).toBe('attention')
    expect(model.verdict?.nodeType).toBe('warn')
  })
})
