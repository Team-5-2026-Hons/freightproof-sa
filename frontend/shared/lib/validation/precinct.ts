// Precinct-specific validation, built from the generic primitives in rules.ts and the
// backend-mirrored constraints in constants.ts.
//
// `address` is validated for LENGTH only. Nothing computes on it and it is optional, so
// it has no `required` rule — but it is not unbounded: the Text column has no ceiling of
// its own, and the value is copied verbatim into the anchored PrecinctEvent payload, so
// the server caps it and this mirrors that cap.
// `is_shared` is a boolean Switch and cannot be invalid by construction.

import { required, maxLength, decimalInRange, intInRange } from './rules'
import {
  LATITUDE_MIN,
  LATITUDE_MAX,
  LONGITUDE_MIN,
  LONGITUDE_MAX,
  GEOFENCE_RADIUS_MIN,
  GEOFENCE_RADIUS_MAX,
  PRECINCT_NAME_MAX,
  PRECINCT_ADDRESS_MAX,
} from './constants'

export type PrecinctField =
  | 'name'
  | 'address'
  | 'latitude'
  | 'longitude'
  | 'geofence_radius_metres'

// Callers supply only the string-valued fields being validated — all form inputs are
// controlled <input> values, hence all strings.
export type PrecinctFormValues = Record<PrecinctField, string>

// Display order of the validated fields, shared by the create and edit forms to focus
// the first invalid field on submit — kept next to PrecinctField so the two can't drift.
export const PRECINCT_FIELD_ORDER: readonly PrecinctField[] = [
  'name',
  'address',
  'latitude',
  'longitude',
  'geofence_radius_metres',
]

// Defined locally rather than shared. That is the established pattern here, not an
// oversight: driver.ts:82 and vehicle.ts:102 each carry their own private copy, and
// matching two existing files beats hoisting a third variant into rules.ts as a
// drive-by change to a file this story has no other reason to restructure.
/** Returns the first error from `rules` for `value`, or null when all pass. */
function firstError(value: string, rules: ReadonlyArray<(v: string) => string | null>): string | null {
  for (const rule of rules) {
    const error = rule(value)
    if (error !== null) {
      return error
    }
  }
  return null
}

/**
 * Validates a precinct form's string fields and returns the first error per field (or
 * null if valid). Mirrors backend/app/schemas/organisations.py so the client surfaces
 * the same problems before submit instead of round-tripping a 422.
 */
export function validatePrecinctForm(
  values: PrecinctFormValues,
): Record<PrecinctField, string | null> {
  return {
    name: firstError(values.name, [required(), maxLength(PRECINCT_NAME_MAX)]),
    // No `required`: an address is optional. maxLength skips empty values, so an omitted
    // address produces no error while an over-long one is caught before the 422.
    address: firstError(values.address, [maxLength(PRECINCT_ADDRESS_MAX)]),
    latitude: firstError(values.latitude, [
      required(),
      decimalInRange(LATITUDE_MIN, LATITUDE_MAX, 'Latitude must be between -90 and 90.'),
    ]),
    longitude: firstError(values.longitude, [
      required(),
      decimalInRange(LONGITUDE_MIN, LONGITUDE_MAX, 'Longitude must be between -180 and 180.'),
    ]),
    geofence_radius_metres: firstError(values.geofence_radius_metres, [
      required(),
      intInRange(
        GEOFENCE_RADIUS_MIN,
        GEOFENCE_RADIUS_MAX,
        `Radius must be between ${GEOFENCE_RADIUS_MIN} m and ${GEOFENCE_RADIUS_MAX} m.`,
      ),
    ]),
  }
}

const COORDINATE_PAIR_PATTERN = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/

// One "DD°MM'SS.s"H" token — the degrees/minutes/seconds format Google Maps shows in
// some of its own UI (distinct from the decimal-degrees format its "Copy coordinates"
// action puts on the clipboard, which COORDINATE_PAIR_PATTERN above handles). Accepts
// both the plain ASCII apostrophe/quote and the proper prime/double-prime marks Maps
// itself renders, since either can end up pasted depending on the source.
const DMS_TOKEN = String.raw`(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*["″]?\s*([NSEWnsew])`
const DMS_PAIR_PATTERN = new RegExp(`^\\s*${DMS_TOKEN}\\s*,?\\s*${DMS_TOKEN}\\s*$`)

// Matches CLICK_COORDINATE_PRECISION in PrecinctForm.tsx / COORDINATE_PRECISION on the
// detail page — this project's established "5dp is close enough" convention (~1m),
// finer than any geofence decision and finer than a click or a DMS second is accurate.
const DMS_TO_DECIMAL_PRECISION = 5

function dmsToDecimal(degrees: number, minutes: number, seconds: number, hemisphere: string): number {
  const magnitude = degrees + minutes / 60 + seconds / 3600
  const isNegativeHemisphere = hemisphere === 'S' || hemisphere === 'W'
  return isNegativeHemisphere ? -magnitude : magnitude
}

/**
 * Parses "26°09'53.9"S 28°14'00.1"E" into decimal-degree field values, or null if the
 * input is not a complete lat(N/S)-then-lng(E/W) DMS pair, or one whose computed
 * magnitude falls outside a valid coordinate range.
 */
function parseDmsPair(raw: string): { lat: string; lng: string } | null {
  const match = DMS_PAIR_PATTERN.exec(raw)
  if (match === null) {
    return null
  }
  const [, latDeg, latMin, latSec, latHemi, lngDeg, lngMin, lngSec, lngHemi] = match
  const latHemiUpper = latHemi.toUpperCase()
  const lngHemiUpper = lngHemi.toUpperCase()
  // Order matters: Google always shows latitude (N/S) before longitude (E/W). A pair
  // in the other shape (or two of the same axis) is not a coordinate, not just an
  // unusual one.
  if (!(latHemiUpper === 'N' || latHemiUpper === 'S')) return null
  if (!(lngHemiUpper === 'E' || lngHemiUpper === 'W')) return null

  const lat = dmsToDecimal(Number(latDeg), Number(latMin), Number(latSec), latHemiUpper)
  const lng = dmsToDecimal(Number(lngDeg), Number(lngMin), Number(lngSec), lngHemiUpper)
  if (lat < LATITUDE_MIN || lat > LATITUDE_MAX) return null
  if (lng < LONGITUDE_MIN || lng > LONGITUDE_MAX) return null

  return { lat: lat.toFixed(DMS_TO_DECIMAL_PRECISION), lng: lng.toFixed(DMS_TO_DECIMAL_PRECISION) }
}

/**
 * Splits a pasted coordinate pair into two field values, or null if the input is not
 * one. Accepts two formats, both accepted at either coordinate field: decimal degrees
 * ("lat, lng" — what Google Maps' "Copy coordinates" action puts on the clipboard) and
 * degrees/minutes/seconds ("26°09'53.9"S 28°14'00.1"E" — what some of Maps' own UI
 * displays instead).
 *
 * This is the replacement for address geocoding (see the plan's D7). A geocoder returns
 * a street centroid, which for a warehouse estate can sit hundreds of metres from the
 * gate — the same order as the geofence radius itself. A pasted coordinate is the exact
 * point the dispatcher chose.
 *
 * Returns null rather than a partial result for anything that is not a complete, in-range
 * pair in either format, so a dispatcher typing a single latitude by hand is never
 * interfered with.
 */
export function parseCoordinatePair(raw: string): { lat: string; lng: string } | null {
  const decimalMatch = COORDINATE_PAIR_PATTERN.exec(raw)
  if (decimalMatch !== null) {
    const [, lat, lng] = decimalMatch
    const latNum = parseFloat(lat)
    const lngNum = parseFloat(lng)
    if (latNum < LATITUDE_MIN || latNum > LATITUDE_MAX) return null
    if (lngNum < LONGITUDE_MIN || lngNum > LONGITUDE_MAX) return null
    return { lat, lng }
  }
  return parseDmsPair(raw)
}
