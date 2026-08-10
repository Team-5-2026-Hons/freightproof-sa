// Driver-specific validation, built from the generic primitives in rules.ts
// and the backend-mirrored constraints in constants.ts.
//
// Consumed by the dispatcher's Add Driver modal (fleet/drivers/page.tsx) and
// the driver detail edit form (fleet/drivers/[id]/page.tsx).
//
// is_active is excluded from DriverField — it's a boolean toggle, never
// invalid. id_number IS included because the create modal collects it; the
// edit form passes the stored (immutable) id_number straight through, never
// rendering it, so its error never surfaces there.

import { required, maxLength, exactLength, pattern, type Rule } from './rules'
import {
  SA_ID_LENGTH,
  SA_ID_PATTERN,
  SA_PHONE_PATTERN,
  SA_PHONE_PARTIAL,
  LOCAL_PHONE_LENGTH,
  INTL_PHONE_LENGTH,
  NAME_MAX,
  LICENSE_MAX,
} from './constants'

export type DriverField =
  | 'full_name'
  | 'id_number'
  | 'phone_number'
  | 'license_number'
  | 'license_expiry'

// Callers supply controlled <input> string values, hence all strings here.
export type DriverFormValues = Record<DriverField, string>

// Display order — shared by the create and edit forms to focus the first
// invalid field on submit, so the two can't drift out of sync.
export const DRIVER_FIELD_ORDER: readonly DriverField[] = [
  'full_name',
  'id_number',
  'phone_number',
  'license_number',
  'license_expiry',
]

/**
 * Validates a driver form's fields, returning the first error per field (or
 * null if valid). Mirrors the constraints enforced server-side in
 * backend/app/schemas/people.py and the column widths in
 * backend/app/db/models/people.py, so the client surfaces the same problems
 * before submit instead of round-tripping a 422.
 *
 * NOTE: license_expiry is required here as a product/UX decision — the backend
 * accepts null. See this document's design section for the rationale.
 */
export function validateDriverForm(values: DriverFormValues): Record<DriverField, string | null> {
  return {
    full_name: firstError(values.full_name, [
      required(),
      maxLength(NAME_MAX),
    ]),

    id_number: firstError(values.id_number, [
      required(),
      exactLength(SA_ID_LENGTH, `ID number must be exactly ${SA_ID_LENGTH} digits`),
      pattern(SA_ID_PATTERN, 'ID number must be digits only'),
    ]),

    phone_number: firstError(values.phone_number, [
      required(),
      saPhone(),
    ]),

    license_number: firstError(values.license_number, [
      required(),
      maxLength(LICENSE_MAX),
    ]),

    license_expiry: validateRequiredDate(values.license_expiry),
  }
}

/** Runs `rules` in order against `value`, returning the first non-null error. */
function firstError(value: string, rules: ReadonlyArray<Rule>): string | null {
  for (const rule of rules) {
    const error = rule(value)
    if (error !== null) {
      return error
    }
  }
  return null
}

/**
 * SA phone rule: accepts local (0XXXXXXXXX) or international (+27XXXXXXXXX)
 * form, tolerating internal whitespace (stripped before matching). Empty is
 * skipped — pair with `required` for the mandatory check. normalisePhone
 * converts a passing value to the canonical +27 form at submit time.
 */
function saPhone(): Rule {
  return (value: string): string | null => {
    if (value.length === 0) {
      return null
    }
    const digits = value.replace(/\s+/g, '')
    if (SA_PHONE_PATTERN.test(digits)) {
      return null
    }
    return 'Enter a valid SA phone number (0XXXXXXXXX or +27XXXXXXXXX)'
  }
}

/** Required date: empty is an error, non-empty must parse to a real date. */
function validateRequiredDate(value: string): string | null {
  if (value.trim().length === 0) {
    return 'Licence expiry is required.'
  }
  if (isNaN(new Date(value).getTime())) {
    return 'Enter a valid date.'
  }
  return null
}

/** Converts a local SA number (0XXXXXXXXX) to international (+27XXXXXXXXX). */
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\s+/g, '')
  if (/^0\d{9}$/.test(digits)) {
    return `+27${digits.slice(1)}`
  }
  return digits
}

/**
 * Live-typing feedback for the phone field, mirroring vinFieldFeedback: a
 * neutral `hint` (running character count) while the value is still a valid
 * prefix mid-entry, a red `error` only once it can't become valid. Both null
 * when empty or fully valid. At most one is non-null.
 */
export function phoneFieldFeedback(value: string): { hint: string | null; error: string | null } {
  const digits = value.replace(/\s+/g, '')
  if (digits.length === 0) {
    return { hint: null, error: null }
  }
  if (SA_PHONE_PATTERN.test(digits)) {
    return { hint: null, error: null }
  }
  // Still a valid prefix toward a complete number — guide, don't alarm.
  if (SA_PHONE_PARTIAL.test(digits)) {
    const target = digits.startsWith('+') ? INTL_PHONE_LENGTH : LOCAL_PHONE_LENGTH
    return { hint: `${digits.length} of ${target} characters`, error: null }
  }
  return { hint: null, error: 'Use 0XXXXXXXXX or +27XXXXXXXXX' }
}
