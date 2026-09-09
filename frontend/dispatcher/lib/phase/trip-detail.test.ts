import { describe, expect, it, beforeEach } from 'vitest'
import { mockTrips } from '@shared/lib/mocks/trips'
import type { Trip } from '@shared/lib/types/trip'
import { tripHeaderFacts } from './trip-detail'
import { putTripSeeds, getTripSeed, __resetTripSeeds, type TripSeed } from '@/lib/trips/tripSeed'

const base = mockTrips[0]

function seed(overrides: Partial<TripSeed> = {}): TripSeed {
  return {
    id: base.id,
    trip_reference: 'FP-SEED-0001',
    order_number: 'ORD-SEED',
    status: 'active',
    driver: { full_name: 'Seeded Driver' },
    horse: { registration: 'CA 000-000' },
    origin_precinct_id: base.origin_precinct_id,
    destination_precinct_id: base.destination_precinct_id,
    needs_review_count: 2,
    created_at: '2026-08-12T08:45:00Z',
    current_phase: 'in_transit',
    current_stop: 1,
    phase_total: 7,
    phase_completed: 4,
    ...overrides,
  }
}

beforeEach(() => { __resetTripSeeds() })

describe('tripHeaderFacts', () => {
  it('returns null when neither a record nor a seed is known', () => {
    expect(tripHeaderFacts(null, null)).toBeNull()
  })

  it('reports cargo and an exception total once the record has loaded', () => {
    const facts = tripHeaderFacts(base, null)

    expect(facts?.reference).toBe(base.trip_reference)
    expect(facts?.cargo).not.toBeNull()
    expect(facts?.exceptionsTotal).toBe(base.exceptions.length)
  })

  it('says no scans are recorded rather than reporting a count of zero', () => {
    const unscanned: Trip = {
      ...base,
      phases: base.phases.map(p => ({ ...p, parcel_count_origin: null, parcel_count_destination: null })),
    }

    // A zero here would assert that nothing was loaded, which is a claim about the
    // evidence; the absence of a scan is not the same as a scan finding nothing.
    expect(tripHeaderFacts(unscanned, null)?.cargo?.note).toBe('No counts recorded yet')
  })

  it('prefers the destination count once delivery has been confirmed', () => {
    // The two counts differ on purpose. The assertion this replaces accepted either one
    // (or neither), so it went on passing while the destination branch was unreachable —
    // the count is written onto the confirmation row, and the reader looked at unloading.
    const delivered: Trip = {
      ...base,
      phases: base.phases.map(p => {
        if (p.phase_type === 'loading') return { ...p, parcel_count_origin: 41 }
        if (p.phase_type === 'confirmation') return { ...p, status: 'completed' as const, parcel_count_destination: 40 }
        return p
      }),
    }

    expect(tripHeaderFacts(delivered, null)?.cargo?.note).toBe('40 recorded at destination')
  })

  it('falls back to the origin count while delivery is unconfirmed', () => {
    const inFlight: Trip = {
      ...base,
      phases: base.phases.map(p => {
        if (p.phase_type === 'loading') return { ...p, parcel_count_origin: 41 }
        if (p.phase_type === 'confirmation') return { ...p, parcel_count_destination: null }
        return p
      }),
    }

    expect(tripHeaderFacts(inFlight, null)?.cargo?.note).toBe('41 recorded at origin')
  })

  it('prefers the loaded record over a seed that disagrees with it', () => {
    const facts = tripHeaderFacts(base, seed({ trip_reference: 'FP-STALE' }))

    expect(facts?.reference).toBe(base.trip_reference)
  })

  it('names the trip from a seed while leaving cargo unread rather than zero', () => {
    const facts = tripHeaderFacts(null, seed())

    expect(facts?.reference).toBe('FP-SEED-0001')
    expect(facts?.driverName).toBe('Seeded Driver')
    expect(facts?.vehicle?.horse.registration).toBe('CA 000-000')
    // A list row has the registration but not the fleet id, so it cannot be linked.
    expect(facts?.vehicle?.horse.id).toBeNull()
    expect(facts?.needsReviewCount).toBe(2)
    // Booked and scanned counts live in consignments and the phase ledger. A zero here
    // would assert that nothing was loaded, which is a claim about the evidence.
    expect(facts?.cargo).toBeNull()
    expect(facts?.exceptionsTotal).toBeNull()
  })

  it('names the next milestone as departure until the trip has actually left', () => {
    const facts = tripHeaderFacts(null, seed({
      planned_departure_at: '2026-08-12T10:45:00Z',
      planned_arrival_at: '2026-08-13T10:45:00Z',
    }))

    // Planned ARRIVAL on a trip that has not departed is the ambiguous label this
    // replaces: it reads as either the driver reporting to load or the truck landing.
    expect(facts?.schedule?.label).toBe('Planned departure')
  })

  it('switches to expected arrival once departure is recorded, noting lateness', () => {
    const facts = tripHeaderFacts(null, seed({
      planned_departure_at: '2026-08-12T10:45:00Z',
      actual_departure_at: '2026-08-12T10:50:00Z',
      planned_arrival_at: '2026-08-13T10:45:00Z',
    }))

    expect(facts?.schedule?.label).toBe('Expected arrival')
    expect(facts?.schedule?.note).toBe('Departed 5 m late')
  })

  it('reports the recorded arrival once the trip has arrived', () => {
    const facts = tripHeaderFacts(null, seed({
      planned_arrival_at: '2026-08-13T10:45:00Z',
      actual_departure_at: '2026-08-12T10:50:00Z',
      actual_arrival_at: '2026-08-12T10:54:00Z',
    }))

    expect(facts?.schedule?.label).toBe('Recorded arrival')
  })

  it('reports the last act on a cancelled trip rather than promising an arrival', () => {
    const facts = tripHeaderFacts(null, seed({
      status: 'cancelled',
      planned_departure_at: '2026-08-12T10:45:00Z',
      actual_departure_at: '2026-08-12T10:50:00Z',
      planned_arrival_at: '2026-08-13T10:45:00Z',
    }))

    // "Expected arrival" here would name a milestone the trip can no longer reach.
    expect(facts?.schedule?.label).toBe('Departed')
    expect(facts?.schedule?.note).toBe('Cancelled after departure')
  })

  it('says a cancelled trip never departed, rather than leaving a departure pending', () => {
    const facts = tripHeaderFacts(null, seed({
      status: 'cancelled',
      planned_departure_at: '2026-08-12T10:45:00Z',
      planned_arrival_at: '2026-08-13T10:45:00Z',
    }))

    expect(facts?.schedule?.label).toBe('Planned departure')
    expect(facts?.schedule?.note).toBe('Cancelled before departure')
  })

  it('leaves the schedule unread for a history seed rather than standing closure in for it', () => {
    const facts = tripHeaderFacts(null, seed({ status: 'closed', current_phase: null }))

    expect(facts?.schedule).toBeNull()
  })

  it('marks trailers pending when a list did not carry them, but names an empty set', () => {
    // Rendering an unread list and a genuinely empty one identically would let a reader
    // conclude a trip has no trailers when nobody has said so yet.
    expect(tripHeaderFacts(null, seed())?.vehicle?.trailers).toBeNull()
    expect(tripHeaderFacts(null, seed({ trailers: [] }))?.vehicle?.trailers).toEqual([])
    expect(tripHeaderFacts(null, seed({ trailers: [{ registration: 'CF 7280' }] }))?.vehicle?.trailers)
      .toEqual([{ id: null, registration: 'CF 7280' }])
  })

  it('links the horse through to its fleet record once the trip has loaded', () => {
    const facts = tripHeaderFacts(base, null)

    expect(facts?.vehicle?.horse.id).toBe(base.horse?.id ?? null)
  })
})

describe('trip seed store', () => {
  it('returns null for a trip no list has shown', () => {
    expect(getTripSeed('unknown-id')).toBeNull()
  })

  it('keeps the most recently listed row for a trip', () => {
    putTripSeeds([seed({ trip_reference: 'FP-OLD' })])
    putTripSeeds([seed({ trip_reference: 'FP-NEW' })])

    expect(getTripSeed(base.id)?.trip_reference).toBe('FP-NEW')
  })
})
