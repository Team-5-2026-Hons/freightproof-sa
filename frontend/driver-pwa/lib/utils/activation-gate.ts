// Why a trip cannot be activated right now — a client-side MIRROR of the server's own
// activation gates in backend/app/orchestration/phase_service.py (_reject_if_not_due and
// the two gates advance_activation calls after it).
//
// The server is the enforcement point and always wins; this exists so the driver is told
// BEFORE they tap. Without it the Activation card looks available, the driver walks the
// whole step capturing GPS, and the submit at the end comes back 409 — the evidence is
// lost and the refusal arrives at the worst possible moment. Pure functions, no I/O, so
// the rules can be unit-tested against the same cases as the Python side.

import type { Trip } from '@shared/lib/types/trip'
import type { CoarseTripStatus } from '@shared/lib/types/phase'

const OPERATIONS_UTC_OFFSET_HOURS = 2

const MS_PER_HOUR = 60 * 60 * 1000

const UNDERWAY_STATUSES: readonly CoarseTripStatus[] = ['active', 'exception_hold']

export function operatingDay(moment: Date): string {
  const shifted = new Date(moment.getTime() + OPERATIONS_UTC_OFFSET_HOURS * MS_PER_HOUR)
  return shifted.toISOString().slice(0, 10)
}

export function isBeforeScheduledDay(now: Date, scheduled: Date): boolean {
  return operatingDay(now) < operatingDay(scheduled)
}

export interface ActivationCandidate {
  id: Trip['id'] | string
  trip_reference: string
  status: CoarseTripStatus
  planned_departure_at: string | null
}

export interface ActivationBlock {
  reason: 'other_trip_underway' | 'not_due_yet' | 'earlier_trip_first'
  blockingTripReference: string | null
  dueDate: string | null
}

const DUE_DATE_FORMAT = new Intl.DateTimeFormat('en-ZA', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

/**
 * Why `trip` cannot be activated right now, or null when nothing blocks it.
 *
 * `others` is the driver's other trips (the GET /trips/me list). Rules are evaluated in
 * the same order the server applies them, so the reason shown here is the reason the
 * server would give.
 */
export function activationBlock(
  trip: ActivationCandidate,
  others: readonly ActivationCandidate[],
  now: Date,
): ActivationBlock | null {
  if (trip.status !== 'created') return null

  const rest = others.filter((t) => String(t.id) !== String(trip.id))

  const underway = rest.find((t) => UNDERWAY_STATUSES.includes(t.status))
  if (underway !== undefined) {
    return { reason: 'other_trip_underway', blockingTripReference: underway.trip_reference, dueDate: null }
  }

  const departure = trip.planned_departure_at
  if (departure !== null) {
    const scheduled = new Date(departure)
    if (isBeforeScheduledDay(now, scheduled)) {
      return {
        reason: 'not_due_yet',
        blockingTripReference: null,
        dueDate: DUE_DATE_FORMAT.format(scheduled),
      }
    }

    const day = operatingDay(scheduled)
    const earlier = rest
      .filter((t) => t.status === 'created' && t.planned_departure_at !== null)
      .filter((t) => operatingDay(new Date(t.planned_departure_at as string)) === day)
      .filter((t) => new Date(t.planned_departure_at as string) < scheduled)
      .sort((a, b) =>
        new Date(a.planned_departure_at as string).getTime()
        - new Date(b.planned_departure_at as string).getTime(),
      )[0]

    if (earlier !== undefined) {
      return { reason: 'earlier_trip_first', blockingTripReference: earlier.trip_reference, dueDate: null }
    }
  }

  return null
}

export function activationBlockMessage(block: ActivationBlock): string {
  switch (block.reason) {
    case 'other_trip_underway':
      return `Finish ${block.blockingTripReference} before starting this trip.`
    case 'not_due_yet':
      return `This trip isn’t due until ${block.dueDate}. You can start it on the day it departs.`
    case 'earlier_trip_first':
      return `${block.blockingTripReference} departs earlier today. Start that one first.`
  }
}
