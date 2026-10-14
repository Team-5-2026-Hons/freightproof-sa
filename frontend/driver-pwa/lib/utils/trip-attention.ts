import type { TripException } from '@shared/lib/types/exception'
import type { Trip } from '@shared/lib/types/trip'

/**
 * Exceptions the driver still has to live with: not yet reviewed, and raised by a person
 * (driver or dispatcher). System-detected ones (gps_mismatch, route_deviation) are the
 * dispatcher's to triage and only clutter the driver's view.
 */
export function openDriverExceptions(exceptions: readonly TripException[]): TripException[] {
  return exceptions.filter((e) => e.review_status !== 'reviewed' && e.source !== 'system')
}

/** A message from dispatch rather than a problem with the load — shown, but never badged. */
export function isDispatcherNote(exception: TripException): boolean {
  return exception.exception_type === 'dispatcher_note'
}

/**
 * Whether the active trip needs the driver's attention: it is on an exception hold, or it
 * carries an open exception that is more than a note. This, not "a trip is assigned", is
 * what earns the badge on the Home tab — an assigned trip is the normal state, and a badge
 * that is always on teaches the driver to ignore it (HIG: reserve badges for critical
 * information). Notes still appear on Home and In Transit; they just don't raise the alarm.
 */
export function tripNeedsAttention(trip: Trip | null, exceptions: readonly TripException[]): boolean {
  if (trip === null) return false
  return trip.status === 'exception_hold'
    || openDriverExceptions(exceptions).some((e) => !isDispatcherNote(e))
}
