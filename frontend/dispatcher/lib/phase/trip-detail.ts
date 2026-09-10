import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import { activePhase, sortedPlan, originScannedCount, destinationScannedCount } from './derive'
import { delayMinutes, fmtDelay } from '@/lib/format/schedule'
import { fmtFull } from '@shared/lib/utils/datetime'
import type { TripSeed } from '@/lib/trips/tripSeed'

export function isTerminalTrip(trip: Trip): boolean {
  return trip.status === 'closed' || trip.status === 'cancelled'
}

export function tripArrival(trip: Trip): string | null {
  // The arrival act is evidence; confirmation and overrides cannot stand in for it.
  const lastTransit = sortedPlan(trip.phases).filter(p => p.phase_type === 'in_transit').at(-1)
  return lastTransit?.status === 'completed' ? lastTransit.completed_at : null
}

export function tripConfirmation(trip: Trip): string | null {
  const confirmation = sortedPlan(trip.phases).filter(p => p.phase_type === 'confirmation').at(-1)
  return confirmation && ['completed', 'exception'].includes(confirmation.status)
    ? confirmation.completed_at : null
}

export function currentTripPhase(trip: Trip): PhaseDescriptor | null {
  return isTerminalTrip(trip) ? null : activePhase(trip.phases)
}

export function precinctAtPhase(trip: Trip, phase: PhaseDescriptor, precincts: Precinct[]): Precinct | undefined {
  const stop = trip.stops.find(s => s.id === phase.trip_stop_id)
  return precincts.find(p => p.id === stop?.precinct_id)
}

export function precinctLabel(precinct: Precinct | undefined): string {
  return precinct?.name.split('—')[0]?.trim() ?? 'Location unavailable'
}

export function phaseStopLabel(trip: Trip, phase: PhaseDescriptor, precincts: Precinct[]): string {
  if (phase.phase_type === 'trip_creation') return 'Dispatcher'
  const stops = [...trip.stops].sort((a, b) => a.sequence - b.sequence)
  const index = stops.findIndex(s => s.id === phase.trip_stop_id)
  const role = index === 0 ? 'Origin' : index === stops.length - 1 ? 'Destination' : 'Stop'
  return `${role} · ${precinctLabel(precinctAtPhase(trip, phase, precincts))}`
}

export function countAtStop(trip: Trip, phase: PhaseDescriptor, direction: 'in' | 'out', field: 'expected' | 'scanned'): number | null {
  const consignments = trip.consignments.filter(c =>
    (direction === 'in' ? c.delivery_stop_id : c.pickup_stop_id) === phase.trip_stop_id,
  )
  if (!phase.trip_stop_id || !consignments.length) return null
  if (field === 'expected' && consignments.some(c => c.parcel_count_expected === null)) return null
  return consignments.reduce((n, c) => n + (field === 'expected'
    ? c.parcel_count_expected ?? 0 : direction === 'in' ? c.scanned_in_count : c.scanned_out_count), 0)
}

export function bookedParcels(trip: Trip): number | null {
  if (trip.trip_type === 'empty_leg') return 0
  if (!trip.consignments.length || trip.consignments.some(c => c.parcel_count_expected === null)) return null
  return trip.consignments.reduce((n, c) => n + (c.parcel_count_expected ?? 0), 0)
}

export interface HeaderFact {
  label: string
  value: string
  /** Secondary line: lateness — context, never a second headline fact. */
  note?: string
}

/** One vehicle on the trip. `id` is null when only a list row is known, which is what
 *  decides whether the header can link through to the fleet record. */
export interface VehicleRef { id: string | null; registration: string }

export interface TripVehicles {
  horse: VehicleRef
  /** Null means the source did not carry trailers, which is NOT the same as a trip having
   *  none — rigid trucks legitimately run without them. Callers render null as pending. */
  trailers: readonly VehicleRef[] | null
}

/**
 * The trip detail header, resolved from the full record when it has loaded and from the
 * list row that led here when it has not.
 *
 * A `null` fact means NOT YET READ, and callers must render it as loading. It must never
 * fall back to an em-dash or a zero: on this page those are evidentiary claims —
 * "no origin count was recorded" is a statement about the trip, and a fact that simply
 * has not arrived yet is not entitled to make it.
 */
export interface TripHeaderFacts {
  reference: string
  orderNumber: string
  originPrecinctId: string | null
  destinationPrecinctId: string | null
  status: Trip['status']
  currentPhase: PhaseDescriptor['phase_type'] | null
  driverName: string
  vehicle: TripVehicles | null
  schedule: HeaderFact | null
  cargo: HeaderFact | null
  needsReviewCount: number
  /** Null when only a list row is known: it carries the review count but no total. */
  exceptionsTotal: number | null
}

/**
 * The next schedule milestone that matters, rather than always naming arrival.
 *
 * "Planned arrival" on a trip that has not left yet is ambiguous — a dispatcher reads it
 * as either the driver reporting to load or the truck reaching its destination. The model
 * has no field for the former at all (only trip-level departure/arrival and per-stop
 * slot_time), so the fix is to stop showing arrival until the trip is actually running.
 */
function scheduleFact(
  status: Trip['status'],
  plannedDeparture: string | null | undefined,
  actualDeparture: string | null | undefined,
  plannedArrival: string | null | undefined,
  actualArrival: string | null,
): HeaderFact | null {
  if (actualArrival) {
    const delay = delayMinutes(plannedArrival ?? null, actualArrival)
    return { label: 'Recorded arrival', value: fmtFull(actualArrival), note: delay === null ? undefined : fmtDelay(delay) }
  }
  // A cancelled trip has no next milestone. Naming one promises an arrival that is not
  // coming, and on a page whose whole claim is "this is what happened" a forward-looking
  // timestamp is the one thing the record cannot support. Report the last act instead.
  if (status === 'cancelled') {
    if (plannedDeparture === undefined) return null
    return actualDeparture
      ? { label: 'Departed', value: fmtFull(actualDeparture), note: 'Cancelled after departure' }
      : { label: 'Planned departure', value: fmtFull(plannedDeparture), note: 'Cancelled before departure' }
  }
  if (actualDeparture) {
    const delay = delayMinutes(plannedDeparture ?? null, actualDeparture)
    return {
      label: 'Expected arrival',
      value: fmtFull(plannedArrival),
      note: delay === null ? undefined : `Departed ${fmtDelay(delay).toLowerCase()}`,
    }
  }
  if (plannedDeparture === undefined) return null
  return { label: 'Planned departure', value: fmtFull(plannedDeparture) }
}

/**
 * What the phase ledger has actually recorded about the cargo.
 *
 * Phrased as "recorded at origin/destination", not "scanned". Both numbers ultimately
 * come from a scan, so scan-versus-count is not the distinction that matters here — the
 * one that does is stamped-versus-live. parcel_count_origin is written ONCE at phase
 * close and is the evidence; the manifest's scanned-out/scanned-in figures are
 * recomputed every request and still moving. Saying "recorded" marks this as the stamped
 * one, which is why the same trip can legitimately show a different number here and in
 * the manifest. Nothing here computes a shortfall — an unrecorded parcel is unrecorded,
 * which is not the same as missing.
 */
function cargoFact(trip: Trip): HeaderFact {
  if (trip.trip_type === 'empty_leg') return { label: 'Cargo', value: 'Empty leg · no cargo booked' }
  const booked = bookedParcels(trip)
  const destination = destinationScannedCount(trip.phases)
  const origin = originScannedCount(trip.phases)
  const recorded = destination !== null
    ? `${destination} recorded at destination`
    : origin !== null
      ? `${origin} recorded at origin`
      : 'No counts recorded yet'
  return { label: 'Cargo', value: `${booked ?? 'Unknown'} booked`, note: recorded }
}

function vehicles(
  horse: { id?: string; registration: string } | undefined,
  trailers: readonly { id?: string; registration: string }[] | undefined,
): TripVehicles {
  return {
    horse: { id: horse?.id ?? null, registration: horse?.registration ?? 'Unassigned' },
    trailers: trailers === undefined ? null : trailers.map(t => ({ id: t.id ?? null, registration: t.registration })),
  }
}

export function tripHeaderFacts(trip: Trip | null, seed: TripSeed | null): TripHeaderFacts | null {
  if (trip) {
    return {
      reference: trip.trip_reference,
      orderNumber: trip.order_number,
      originPrecinctId: trip.origin_precinct_id,
      destinationPrecinctId: trip.destination_precinct_id,
      status: trip.status,
      currentPhase: currentTripPhase(trip)?.phase_type ?? null,
      driverName: trip.driver?.full_name ?? 'Unassigned',
      vehicle: vehicles(trip.horse ?? undefined, trip.trailers),
      schedule: scheduleFact(trip.status, trip.planned_departure_at, trip.actual_departure_at, trip.planned_arrival_at, tripArrival(trip)),
      cargo: cargoFact(trip),
      needsReviewCount: trip.exceptions.filter(e => e.review_status === 'needs_review').length,
      exceptionsTotal: trip.exceptions.length,
    }
  }
  if (!seed) return null
  return {
    reference: seed.trip_reference,
    orderNumber: seed.order_number,
    originPrecinctId: seed.origin_precinct_id,
    destinationPrecinctId: seed.destination_precinct_id,
    status: seed.status,
    currentPhase: seed.current_phase,
    driverName: seed.driver.full_name,
    vehicle: vehicles(seed.horse, seed.trailers),
    // The history list carries no schedule at all, so this stays unread rather than being
    // invented from closed_at — closing a trip is not arriving.
    schedule: scheduleFact(seed.status, seed.planned_departure_at, seed.actual_departure_at, seed.planned_arrival_at, seed.actual_arrival_at ?? null),
    // Booked and scanned counts live in consignments and the phase ledger; a list row
    // has neither, so cargo is genuinely unknown until the record lands.
    cargo: null,
    needsReviewCount: seed.needs_review_count,
    exceptionsTotal: null,
  }
}
