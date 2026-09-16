// Precinct-specific validation, built from the generic primitives in rules.ts and the
// backend-mirrored constraints in constants.ts.
//
// `address` is validated for LENGTH only, and optional: the Text column has no ceiling
// of its own, but the value is copied verbatim into the anchored PrecinctEvent payload,
// so the server caps it and this mirrors that cap.

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

export type PrecinctFormValues = Record<PrecinctField, string>

// Display order, shared by create and edit forms to focus the first invalid field on
// submit — kept next to PrecinctField so the two can't drift.
export const PRECINCT_FIELD_ORDER: readonly PrecinctField[] = [
  'name',
  'address',
  'latitude',
  'longitude',
  'geofence_radius_metres',
]

// Defined locally rather than shared — driver.ts and vehicle.ts each carry their own copy.
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

/** Validates a precinct form and returns the first error per field, or null if valid. */
export function validatePrecinctForm(
  values: PrecinctFormValues,
): Record<PrecinctField, string | null> {
  return {
    name: firstError(values.name, [required(), maxLength(PRECINCT_NAME_MAX)]),
    // No `required`: address is optional; maxLength skips empty values.
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

// One "DD°MM'SS.s"H" token — the degrees/minutes/seconds format some Google Maps UI
// shows (distinct from the decimal-degrees "Copy coordinates" format, handled above).
// Accepts both plain ASCII and proper prime/double-prime marks.
const DMS_TOKEN = String.raw`(\d{1,3})\s*°\s*(\d{1,2})\s*['′]\s*(\d{1,2}(?:\.\d+)?)\s*["″]?\s*([NSEWnsew])`
const DMS_PAIR_PATTERN = new RegExp(`^\\s*${DMS_TOKEN}\\s*,?\\s*${DMS_TOKEN}\\s*$`)

// Matches CLICK_COORDINATE_PRECISION in PrecinctForm.tsx / COORDINATE_PRECISION on the
// detail page — ~1m, finer than any geofence decision.
const DMS_TO_DECIMAL_PRECISION = 5

function dmsToDecimal(degrees: number, minutes: number, seconds: number, hemisphere: string): number {
  const magnitude = degrees + minutes / 60 + seconds / 3600
  const isNegativeHemisphere = hemisphere === 'S' || hemisphere === 'W'
  return isNegativeHemisphere ? -magnitude : magnitude
}

/** Parses "26°09'53.9"S 28°14'00.1"E" into decimal-degree field values, or null if invalid. */
function parseDmsPair(raw: string): { lat: string; lng: string } | null {
  const match = DMS_PAIR_PATTERN.exec(raw)
  if (match === null) {
    return null
  }
  const [, latDeg, latMin, latSec, latHemi, lngDeg, lngMin, lngSec, lngHemi] = match
  const latHemiUpper = latHemi.toUpperCase()
  const lngHemiUpper = lngHemi.toUpperCase()
  // Order matters: latitude (N/S) always precedes longitude (E/W).
  if (!(latHemiUpper === 'N' || latHemiUpper === 'S')) return null
  if (!(lngHemiUpper === 'E' || lngHemiUpper === 'W')) return null

  const lat = dmsToDecimal(Number(latDeg), Number(latMin), Number(latSec), latHemiUpper)
  const lng = dmsToDecimal(Number(lngDeg), Number(lngMin), Number(lngSec), lngHemiUpper)
  if (lat < LATITUDE_MIN || lat > LATITUDE_MAX) return null
  if (lng < LONGITUDE_MIN || lng > LONGITUDE_MAX) return null

  return { lat: lat.toFixed(DMS_TO_DECIMAL_PRECISION), lng: lng.toFixed(DMS_TO_DECIMAL_PRECISION) }
}

/**
 * Splits a pasted coordinate pair into two field values, or null if the input is not one.
 * Accepts decimal degrees ("lat, lng") and DMS ("26°09'53.9"S 28°14'00.1"E") — both
 * formats Google Maps can put on the clipboard. Replaces address geocoding: a geocoder's
 * street centroid can sit hundreds of metres off for a warehouse estate, a pasted
 * coordinate is exact. Returns null (not a partial result) for anything incomplete, so a
 * dispatcher typing a single latitude by hand is never interfered with.
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
