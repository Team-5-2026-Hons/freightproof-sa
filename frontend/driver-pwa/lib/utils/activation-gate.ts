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

// Mirrors settings.OPERATIONS_UTC_OFFSET_HOURS (backend/app/core/config.py). NOT the
// device's own timezone: a phone that has drifted onto another zone (roaming near a
// border, a manually-set clock) must not decide whether a trip is due — the operator's
// calendar day is a fixed business rule, which is exactly why the backend pins it too.
const OPERATIONS_UTC_OFFSET_HOURS = 2

const MS_PER_HOUR = 60 * 60 * 1000

// Statuses meaning a trip is underway — the driver has activated it. Mirrors the
// backend's own ranking in trip_service.get_active_trip_for_driver.
const UNDERWAY_STATUSES: readonly CoarseTripStatus[] = ['active', 'exception_hold']

// The calendar date `moment` falls on in the operator's timezone, as a sortable
// 'YYYY-MM-DD' string. Shifting the instant and then reading its UTC parts is what keeps
// this independent of the device's own zone (see OPERATIONS_UTC_OFFSET_HOURS above).
export function operatingDay(moment: Date): string {
  const shifted = new Date(moment.getTime() + OPERATIONS_UTC_OFFSET_HOURS * MS_PER_HOUR)
  return shifted.toISOString().slice(0, 10)
}

// True when `now` falls on an EARLIER operating day than `scheduled`. Strictly earlier,
// so any time on the scheduled day passes and activating LATE is never blocked — a
// delayed trip still needs its evidence captured. Mirrors phase_service's
// is_before_scheduled_day exactly, including that asymmetry.
export function isBeforeScheduledDay(now: Date, scheduled: Date): boolean {
  return operatingDay(now) < operatingDay(scheduled)
}

// Minimum a row must carry to take part in the gates. Deliberately structural rather
// than fixed to DriverTripSummary, so a full Trip satisfies it too.
export interface ActivationCandidate {
  id: Trip['id'] | string
  trip_reference: string
  status: CoarseTripStatus
  planned_departure_at: string | null
}

export interface ActivationBlock {
  // Which rule fired. The UI picks its copy from this rather than string-matching.
  reason: 'other_trip_underway' | 'not_due_yet' | 'earlier_trip_first'
  // The trip standing in the way, for the two rules that have one.
  blockingTripReference: string | null
  // Pre-formatted operating day this trip becomes due, for 'not_due_yet'.
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
  // Only the act of STARTING a trip is gated. Anything already underway or finished has
  // passed activation, and its later phases are deliberately not date-sensitive (an
  // overnight trip must be able to finish the following day).
  if (trip.status !== 'created') return null

  const rest = others.filter((t) => String(t.id) !== String(trip.id))

  // 1. One trip at a time. A trip already underway blocks starting any other.
  const underway = rest.find((t) => UNDERWAY_STATUSES.includes(t.status))
  if (underway !== undefined) {
    return { reason: 'other_trip_underway', blockingTripReference: underway.trip_reference, dueDate: null }
  }

  // 2. Not before its own operating day. Skipped entirely when the trip carries no
  // planned departure: the server falls back to the earliest booked stop's slot time,
  // which this screen does not have, so guessing here would block a trip the server
  // would happily allow. Let the server be the one to refuse that case.
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

    // 3. Earliest first, within one operating day. Two trips due the same day must be
    // started in departure order; trips on other days are already handled by rule 2.
    const day = operatingDay(scheduled)
    const earlier = rest
      .filter((t) => t.status === 'created' && t.planned_departure_at !== null)
      .filter((t) => operatingDay(new Date(t.planned_departure_at as string)) === day)
      .filter((t) => new Date(t.planned_departure_at as string) < scheduled)
      // Earliest of the earlier ones — that is the trip the driver must run first.
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

// Driver-facing copy for a block. Kept beside the rules so a new rule cannot be added
// without its message.
export function activationBlockMessage(block: ActivationBlock): string {
  switch (block.reason) {
    case 'other_trip_underway':
      return `Finish ${block.blockingTripReference} before starting this trip.`
    case 'not_due_yet':
      return `This trip isn’t due until ${block.dueDate}. You can start it on the day it departs.`
    case 'earlier_trip_first':
      return `${block.blockingTripReference} departs earlier today — start that one first.`
  }
}
