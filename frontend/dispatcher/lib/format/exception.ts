// Exception display formatting, module-scoped so both the trip timeline's cards and the
// in-transit leg's mini-timeline render the same exception the same way.

import type { TripExceptionDetail } from '@shared/lib/types/exception'
import { NO_DATA } from './analytics'
import { fmtAge } from './period'
import { VEHICLE_TYPE_LABELS } from './vehicle'
import { fmtSastDateParts, fmtSastDateTime } from '@shared/lib/utils/datetime'

export const VEHICLE_NOT_RECORDED = 'Not recorded'

const EXCEPTION_TYPE_LABELS: Partial<Record<string, string>> = {
  gps_mismatch: 'GPS mismatch',
  driver_vehicle_separation: 'Driver–vehicle separation',
  driver_location_mismatch: 'Driver outside precinct',
  trailer_separated_in_transit: 'Trailer separated on the road',
  moved_before_departure: 'Moved before departure',
  tracker_silent: 'Tracker silent',
  driver_substitution: 'Driver transfer needs review',
}

/** "waybill_count_mismatch" -> "Waybill Count Mismatch"; "receiver_id_mismatch" ->
 *  "Receiver ID Mismatch" (an abbreviation reads wrong title-cased as "Id"); an explicit
 *  EXCEPTION_TYPE_LABELS entry wins over the generic rule. */
export function fmtExceptionType(type: string): string {
  return EXCEPTION_TYPE_LABELS[type]
    ?? type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).replace(/\bId\b/g, 'ID')
}

const CANCEL_NOTE_PREFIX = /^Cancelled by user [0-9a-f-]{36}: /i
const CANCEL_NOTE_PREFIX_LABEL = 'Cancelled by '
const UNNAMED_DISPATCHER = 'a dispatcher'

/** The description to show a person. A dispatcher's cancellation note carries the cancelling
 *  user's id; the cancelling dispatcher is recorded as the reviewer, so the reviewer's name
 *  replaces it. Every other description is returned untouched. */
export function exceptionDescriptionText(
  exception: { exception_type: string; description: string; reviewed_by_name?: string | null },
): string {
  if (exception.exception_type !== 'dispatcher_note') return exception.description
  const match = CANCEL_NOTE_PREFIX.exec(exception.description)
  if (!match) return exception.description
  return `${CANCEL_NOTE_PREFIX_LABEL}${exception.reviewed_by_name ?? UNNAMED_DISPATCHER}: ${exception.description.slice(match[0].length)}`
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

export const RAISED_TIME_UNAVAILABLE = 'Raised time unavailable'

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

const EXCEPTION_REF_PREFIX = 'EX-'
const EXCEPTION_REF_LENGTH = 8

/** A short, stable label for telling identical-looking exceptions apart: "EX-3F9A21C4". Derived
 *  from the exception's id, so there is nothing extra to store and it cannot drift. */
export function exceptionReference(id: string): string {
  return `${EXCEPTION_REF_PREFIX}${id.replaceAll('-', '').slice(0, EXCEPTION_REF_LENGTH).toUpperCase()}`
}

/** Whether `query` (already non-empty) is part of the exception's reference. Matches the hex part
 *  only, or the whole "EX-…" form: matching the fixed prefix itself would make 'x' or 'ex' hit every row. */
export function matchesExceptionReference(id: string, query: string): boolean {
  const hex = exceptionReference(id).slice(EXCEPTION_REF_PREFIX.length).toLowerCase()
  const q = query.toLowerCase()
  const prefix = EXCEPTION_REF_PREFIX.toLowerCase()
  return hex.includes(q.startsWith(prefix) ? q.slice(prefix.length) : q)
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
