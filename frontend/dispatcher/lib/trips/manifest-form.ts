// Rules for the create-trip screen (FP-281 §5, §11): what the dispatcher must still enter,
// whether it is valid, and the exact request each mode sends. Pure: no React, no I/O.

import type { PPManifestPreview, TripFromPPManifestPayload } from '@shared/lib/types/pp-manifest'
import type { TripCreatePayload } from '@shared/lib/types/trip'
import { OPERATIONS_TIMEZONE, SAST_OFFSET } from '@shared/lib/utils/datetime'

/** Driver, horse and trailers: LFG's decision, never read from the manifest (spec §5). */
export interface CrewValues {
  driverId: string
  horseId: string
  trailerIds: string[]
}

/** A time the dispatcher typed over, as a SAST datetime-local value. null follows the source:
 *  the manifest's own time, or nothing for an empty leg. */
export interface ScheduleOverrides {
  departure: string | null
  arrival: string | null
}

/** Precincts the dispatcher chose: both ends of an empty leg, or a hub PP could not link. */
export interface RoutePicks {
  originId: string
  destinationId: string
}

/** Times as datetime-local values, '' where there is none. */
export interface TimeInputs {
  departure: string
  arrival: string
}

export type FormField = 'driver' | 'horse' | 'trailers' | 'origin' | 'destination' | 'departure' | 'arrival'
export type FieldErrors = Partial<Record<FormField, string>>

export interface ManifestGaps {
  origin: boolean
  destination: boolean
}

export const EMPTY_CREW: CrewValues = { driverId: '', horseId: '', trailerIds: [] }
export const NO_OVERRIDES: ScheduleOverrides = { departure: null, arrival: null }
export const NO_PICKS: RoutePicks = { originId: '', destinationId: '' }
export const NO_TIMES: TimeInputs = { departure: '', arrival: '' }

// Mirrors the backend's MINIMUM_TRIP_DURATION (core/constants.py). The create endpoints
// refuse a shorter declared trip, so the form says so under the field instead of after a
// round trip.
const MINIMUM_TRIP_MINUTES = 15
const MS_PER_MINUTE = 60_000

// A positive whole number of at most nine significant digits, which keeps every value
// inside a Postgres integer (trips.pp_manifest_number). Leading zeros are allowed: a printed
// manifest may pad its number, and 081 is manifest 81.
const MANIFEST_NUMBER = /^0*[1-9]\d{0,8}$/

/** The typed manifest number, or null when the input is not one. */
export function parseManifestNumber(input: string): number | null {
  const trimmed = input.trim()
  return MANIFEST_NUMBER.test(trimmed) ? Number(trimmed) : null
}

// Numeric fields and h23 so the parts can be joined without any locale wording, and midnight
// reads "00", not "24".
const SAST_INPUT_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: OPERATIONS_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

/** An instant as a datetime-local value in SAST. Operations run on South African time whatever
 *  the dispatcher's machine says, so the input is never read from the browser's own zone, which
 *  would make the same trip show different times on different machines. */
export function isoToSastInput(iso: string): string {
  const parts = SAST_INPUT_FORMAT.formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(p => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`
}

/** A datetime-local value, read as SAST, as a UTC instant. The create endpoints refuse zone-less
 *  times, and the journey lock hashes UTC (spec §9). */
export function sastInputToIso(value: string): string {
  return new Date(`${value}:00${SAST_OFFSET}`).toISOString()
}

/** The manifest's own times as input values: what an untouched field shows. */
export function manifestTimes(preview: PPManifestPreview): TimeInputs {
  return {
    departure: preview.planned_departure_at ? isoToSastInput(preview.planned_departure_at) : '',
    arrival: preview.expected_arrival_at ? isoToSastInput(preview.expected_arrival_at) : '',
  }
}

/** What each time field shows: the dispatcher's own value, else the source's. */
export function shownTimes(overrides: ScheduleOverrides, source: TimeInputs): TimeInputs {
  return {
    departure: overrides.departure ?? source.departure,
    arrival: overrides.arrival ?? source.arrival,
  }
}

/** Hubs PP could not link to a precinct: the only route values the dispatcher supplies (spec §5). */
export function manifestGaps(preview: PPManifestPreview): ManifestGaps {
  return {
    origin: preview.origin.precinct_id === null,
    destination: preview.destination.precinct_id === null,
  }
}

export function validateCrew(crew: CrewValues, trailersValid: boolean): FieldErrors {
  const errors: FieldErrors = {}
  if (!crew.driverId) errors.driver = 'Select a driver.'
  if (!crew.horseId) errors.horse = 'Select a horse.'
  if (!trailersValid) errors.trailers = 'Fix the trailer combination.'
  return errors
}

/** shown: what the fields display. source: what the manifest supplies ('' for none). */
export function validateSchedule(shown: TimeInputs, source: TimeInputs): FieldErrors {
  const errors: FieldErrors = {}
  // A trip with no planned departure can never be activated (spec §10.2 step 3).
  if (!shown.departure) errors.departure = 'Enter a planned departure.'
  if (!shown.arrival && source.arrival) {
    // A null override means "keep the manifest's", so an emptied field would still lock
    // the manifest's arrival. Refuse rather than show one thing and lock another.
    errors.arrival = 'The manifest sets an expected arrival, so it cannot be removed. Change it, or use the manifest time.'
  } else if (shown.departure && shown.arrival) {
    // Both go through the same SAST reading as the payload, so the check judges the instants that
    // will actually be sent.
    const minutes = (
      new Date(sastInputToIso(shown.arrival)).getTime() - new Date(sastInputToIso(shown.departure)).getTime()
    ) / MS_PER_MINUTE
    if (minutes <= 0) errors.arrival = 'Must be after departure.'
    else if (minutes < MINIMUM_TRIP_MINUTES) {
      errors.arrival = `Must be at least ${MINIMUM_TRIP_MINUTES} minutes after departure.`
    }
  }
  return errors
}

export function validateManifestRoute(preview: PPManifestPreview, picks: RoutePicks): FieldErrors {
  const gaps = manifestGaps(preview)
  const errors: FieldErrors = {}
  if (gaps.origin && !picks.originId) errors.origin = `Choose the precinct for hub ${preview.origin.hub_code}.`
  if (gaps.destination && !picks.destinationId) {
    errors.destination = `Choose the precinct for hub ${preview.destination.hub_code}.`
  }
  const origin = gaps.origin ? picks.originId : preview.origin.precinct_id
  const destination = gaps.destination ? picks.destinationId : preview.destination.precinct_id
  if (origin && origin === destination) {
    // Blame the end the dispatcher chose: the manifest's own end is not theirs to change.
    errors[gaps.destination ? 'destination' : 'origin'] = 'Origin and destination must be different precincts.'
  }
  return errors
}

export function validateEmptyLegRoute(picks: RoutePicks): FieldErrors {
  const errors: FieldErrors = {}
  if (!picks.originId) errors.origin = 'Select an origin precinct.'
  if (!picks.destinationId) errors.destination = 'Select a destination precinct.'
  else if (picks.originId === picks.destinationId) errors.destination = 'Must differ from origin.'
  return errors
}

/** A time to send. null keeps the source's own value, which the server then uses exactly
 *  (spec §10.2: the request overrides the manifest). Echoing an untouched manifest time
 *  would record it as the dispatcher's override, after a round trip through a
 *  minute-precision local input. */
function overrideToIso(override: string | null, source: string): string | null {
  if (override === null || override === '' || override === source) return null
  return sastInputToIso(override)
}

export function buildFromManifestPayload(
  preview: PPManifestPreview,
  crew: CrewValues,
  overrides: ScheduleOverrides,
  picks: RoutePicks,
): TripFromPPManifestPayload {
  const source = manifestTimes(preview)
  const gaps = manifestGaps(preview)
  return {
    manifest_number: preview.pp_manifest.number,
    expected_snapshot_sha256: preview.snapshot_sha256,
    driver_id: crew.driverId,
    horse_id: crew.horseId,
    trailer_ids: crew.trailerIds,
    planned_departure_at: overrideToIso(overrides.departure, source.departure),
    planned_arrival_at: overrideToIso(overrides.arrival, source.arrival),
    // A pick for a linked hub is ignored by the server, so it is not sent at all.
    origin_precinct_id: gaps.origin ? picks.originId : null,
    destination_precinct_id: gaps.destination ? picks.destinationId : null,
  }
}

export function buildEmptyLegPayload(
  crew: CrewValues,
  overrides: ScheduleOverrides,
  picks: RoutePicks,
): TripCreatePayload {
  return {
    trip_type: 'empty_leg',
    driver_id: crew.driverId,
    horse_id: crew.horseId,
    trailer_ids: crew.trailerIds,
    origin_precinct_id: picks.originId,
    destination_precinct_id: picks.destinationId,
    consignments: [],
    planned_departure_at: overrides.departure ? sastInputToIso(overrides.departure) : null,
    planned_arrival_at: overrides.arrival ? sastInputToIso(overrides.arrival) : null,
  }
}
