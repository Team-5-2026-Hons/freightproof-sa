// Exception display formatting, module-scoped so both the trip timeline's cards and the
// in-transit leg's mini-timeline render the same exception the same way.

import type { TripExceptionDetail } from '@shared/lib/types/exception'
import { NO_DATA } from './analytics'
import { fmtAge } from './period'
import { VEHICLE_TYPE_LABELS } from './vehicle'
import { fmtSastDateParts, fmtSastDateTime } from '@shared/lib/utils/datetime'

export const VEHICLE_NOT_RECORDED = 'Not recorded'

// Types whose generic title-casing below reads wrong. The en dash is deliberate: it is
// a relation between two parties ("driver–vehicle"), not a hyphenated word.
const EXCEPTION_TYPE_LABELS: Partial<Record<string, string>> = {
  gps_mismatch: 'GPS mismatch',
  driver_vehicle_separation: 'Driver–vehicle separation',
  // The driver's phone, not the tracker, was outside the expected precinct, kept
  // distinct in wording from driver_vehicle_separation (a tracker disagreement) so a
  // dispatcher scanning the queue can't mistake one for the other.
  driver_location_mismatch: 'Driver outside precinct',
  // The three road findings (road_check_service) read as one family, in the same
  // sentence case as the labels above. "In transit" title-cased reads like a phase
  // name; the dispatcher needs the place.
  trailer_separated_in_transit: 'Trailer separated on the road',
  moved_before_departure: 'Moved before departure',
  tracker_silent: 'Tracker silent',
}

/** "waybill_count_mismatch" -> "Waybill Count Mismatch"; "receiver_id_mismatch" ->
 *  "Receiver ID Mismatch" (an abbreviation reads wrong title-cased as "Id"); an explicit
 *  EXCEPTION_TYPE_LABELS entry wins over the generic rule. */
export function fmtExceptionType(type: string): string {
  return EXCEPTION_TYPE_LABELS[type]
    ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bId\b/g, 'ID')
}

/** A breakdown's Vehicle row: "Trailer · TRL 222 GP". "Not recorded" when no vehicle was
 *  recorded. A dash when one was recorded but its vehicle row is gone, so the backend
 *  could name neither its kind nor its plate. */
export function fmtBreakdownVehicle(
  exception: Pick<TripExceptionDetail, 'vehicle_id' | 'vehicle_registration' | 'vehicle_type'>,
): string {
  if (exception.vehicle_id === null) return VEHICLE_NOT_RECORDED
  const parts = [
    exception.vehicle_type ? VEHICLE_TYPE_LABELS[exception.vehicle_type] : null,
    exception.vehicle_registration,
  ].filter((part): part is string => part !== null && part !== '')
  return parts.length > 0 ? parts.join(' · ') : NO_DATA
}

export const EXCEPTION_TIMEZONE = 'Africa/Johannesburg'
export const RAISED_TIME_UNAVAILABLE = 'Raised time unavailable'

export function exceptionCalendarDay(iso: string): string | null {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en', { timeZone: EXCEPTION_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const part = (type: string): string => parts.find(p => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** "03 Sep 2026, 12:00 SAST", or the unavailable message for an unreadable timestamp. */
export function fmtExceptionRaised(iso: string): string {
  return fmtSastDateTime(iso) ?? RAISED_TIME_UNAVAILABLE
}

/** The day and the time as separate strings, for cells that stack them. */
export function fmtExceptionRaisedParts(iso: string): { day: string; time: string } | null {
  return fmtSastDateParts(iso)
}

const JUST_NOW = 'just now'

/** How long ago a claim was taken: "just now", "2 min ago", "3 h ago". Null for a missing
 *  or unreadable timestamp, so the cell can omit it rather than print "NaN". */
export function fmtClaimedFor(claimedAtIso: string | null, now: Date): string | null {
  if (!claimedAtIso || !Number.isFinite(Date.parse(claimedAtIso))) return null
  const age = fmtAge(claimedAtIso, now)
  return age === '0 min' ? JUST_NOW : `${age} ago`
}

/** Stop numbers are recorded values, not facility names or inferred display indexes. */
export function fmtExceptionPhaseStop(phase: string | null, stop: number | null): string | null {
  return [phase ? phase.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : null, stop !== null ? `Recorded stop ${stop}` : null].filter(Boolean).join(' · ') || null
}

export const ROUTE_NOT_RECORDED = 'Route not recorded'
const UNKNOWN_PLACE = 'Unknown'

/** "Cape Town Depot (Epping)" -> "Cape Town Depot". Lists drop the parenthesised suburb to
 *  stay on one line; the detail page keeps the full name. */
export function shortPlaceName(name: string): string {
  return name.split(/\s*\(/)[0] || name
}

/** "Johannesburg DC → Durban Depot". One side missing keeps the arrow so it still reads as a
 *  route; both missing is stated rather than left blank. */
export function fmtExceptionRoute(origin: string | null, destination: string | null, short = false): string {
  if (!origin && !destination) return ROUTE_NOT_RECORDED
  const label = (name: string | null): string => name ? (short ? shortPlaceName(name) : name) : UNKNOWN_PLACE
  return `${label(origin)} → ${label(destination)}`
}
