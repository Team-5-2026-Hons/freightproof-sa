// Vehicle-specific validation, built from the generic primitives in
// rules.ts and the backend-mirrored constraints in constants.ts.
//
// Consumed by the dispatcher's vehicle create/edit forms (separate task).
// length_m and is_active are deliberately excluded from VehicleField:
// length_m is a constrained <select> of 6/12/18 in the UI (can't be
// invalid by construction), and is_active is a boolean toggle.

import { required, maxLength, exactLength, pattern, intInRange } from './rules'
import {
  VIN_LENGTH,
  VIN_PATTERN,
  REGISTRATION_MAX,
  PULSIT_MAX,
  MAKE_MODEL_MAX,
  YEAR_MIN,
} from './constants'

export type VehicleField =
  | 'registration'
  | 'pulsit_device_id'
  | 'vin_number'
  | 'licence_disc_expiry'
  | 'make'
  | 'model'
  | 'year'
  | 'gross_vehicle_mass_kg'

// Callers only need to supply the string-valued fields being validated —
// all form inputs are controlled <input> values, hence all strings here.
export type VehicleFormValues = Record<VehicleField, string>

// Display order of the validated fields. Shared by the create and edit forms
// to focus the first invalid field on submit — kept here, next to VehicleField,
// so the two pages can't drift out of sync.
export const VEHICLE_FIELD_ORDER: readonly VehicleField[] = [
  'registration',
  'pulsit_device_id',
  'vin_number',
  'licence_disc_expiry',
  'make',
  'model',
  'year',
  'gross_vehicle_mass_kg',
]

// gross_vehicle_mass_kg has no natural upper bound, so the range rule's
// ceiling is just the largest integer JS can represent exactly.
const POSITIVE_INT_MAX = Number.MAX_SAFE_INTEGER

/** Returns true if `value` is a syntactically valid date string (e.g. from <input type="date">). */
function isValidDateString(value: string): boolean {
  return !isNaN(new Date(value).getTime())
}

/**
 * Validates a vehicle form's string fields and returns the first error per
 * field (or null if that field is valid). Mirrors the constraints enforced
 * server-side in backend/app/schemas/vehicles.py so the client surfaces the
 * same problems before submit instead of round-tripping a 422.
 */
export function validateVehicleForm(values: VehicleFormValues): Record<VehicleField, string | null> {
  const currentYearCeiling = new Date().getFullYear() + 1

  return {
    registration: firstError(values.registration, [
      required(),
      maxLength(REGISTRATION_MAX),
    ]),

    pulsit_device_id: firstError(values.pulsit_device_id, [
      required(),
      maxLength(PULSIT_MAX),
    ]),

    // Optional overall — empty is valid. If filled in, must be exactly 17
    // alphanumeric characters (no ISO 3779 I/O/Q exclusion, per product decision).
    vin_number: firstError(values.vin_number, [
      exactLength(VIN_LENGTH, `VIN must be exactly ${VIN_LENGTH} characters`),
      pattern(VIN_PATTERN, 'VIN must contain only letters and numbers'),
    ]),

    licence_disc_expiry: validateOptionalDate(values.licence_disc_expiry),

    make: firstError(values.make, [maxLength(MAKE_MODEL_MAX)]),

    model: firstError(values.model, [maxLength(MAKE_MODEL_MAX)]),

    // Ceiling computed live (current year + 1), not a stored constant —
    // mirrors the backend's _validate_year, which does the same.
    year: firstError(values.year, [
      intInRange(YEAR_MIN, currentYearCeiling, `Year must be between ${YEAR_MIN} and ${currentYearCeiling}`),
    ]),

    gross_vehicle_mass_kg: firstError(values.gross_vehicle_mass_kg, [
      intInRange(1, POSITIVE_INT_MAX, 'Must be a positive whole number'),
    ]),
  }
}

/** Runs `rules` in order against `value`, returning the first non-null error message. */
function firstError(value: string, rules: ReadonlyArray<(value: string) => string | null>): string | null {
  for (const rule of rules) {
    const error = rule(value)
    if (error !== null) {
      return error
    }
  }
  return null
}

function validateOptionalDate(value: string): string | null {
  if (value.length === 0) {
    return null
  }
  if (!isValidDateString(value)) {
    return 'Enter a valid date.'
  }
  return null
}

/**
 * Live-typing feedback for the VIN field, split so the UI can style each part
 * correctly: `hint` is neutral guidance shown while the user is still mid-entry
 * (a running character count), `error` is a genuine problem to flag in red.
 * Both are null when the field is empty or fully valid. At most one is non-null.
 */
export function vinFieldFeedback(value: string): { hint: string | null; error: string | null } {
  if (value.length === 0) {
    return { hint: null, error: null }
  }

  // Still typing toward 17 — guide, don't alarm. (Save stays gated by
  // validateVehicleForm's exactLength rule until the field is complete.)
  if (value.length < VIN_LENGTH) {
    return { hint: `${value.length} of ${VIN_LENGTH} characters`, error: null }
  }

  // value.length >= VIN_LENGTH. The UI enforces maxLength={17} so >17 shouldn't
  // occur, but if it does, treat it the same as a pattern mismatch rather than
  // silently passing it through.
  if (!VIN_PATTERN.test(value)) {
    return { hint: null, error: 'VIN must be letters and numbers only' }
  }

  return { hint: null, error: null }
}
