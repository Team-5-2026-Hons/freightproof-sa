// Pure, dependency-free validation rule primitives.
//
// Each rule is a factory that returns a `(value: string) => string | null`
// checker: `null` means valid, a string is the error message to show.
// Composable so form-specific validators (e.g. vehicle.ts) can chain them
// per field without re-implementing the same checks.
//
// Framework-agnostic on purpose — consumed via @shared/* by both the
// dispatcher and driver-pwa Next.js apps, neither of which should pull
// React/Next into this layer.

export type Rule = (value: string) => string | null

const DEFAULT_REQUIRED_MESSAGE = 'This field is required.'

/** Fails when the trimmed value is empty. The only rule that fires on empty input. */
export function required(message: string = DEFAULT_REQUIRED_MESSAGE): Rule {
  return (value: string): string | null => {
    if (value.trim().length === 0) {
      return message
    }
    return null
  }
}

/**
 * Fails when value.length exceeds `n`. Empty values are skipped — pairing
 * with `required` separately is how callers decide if the field is mandatory.
 */
export function maxLength(n: number, message?: string): Rule {
  const errorMessage = message ?? `Must be ${n} characters or fewer.`
  return (value: string): string | null => {
    if (value.length === 0) {
      return null
    }
    if (value.length > n) {
      return errorMessage
    }
    return null
  }
}

/**
 * Fails when a non-empty value's length isn't exactly `n`. For fields that
 * are optional overall but must be a fixed width when filled in (e.g. VIN) —
 * compose with `required` separately if the field is also mandatory.
 */
export function exactLength(n: number, message?: string): Rule {
  const errorMessage = message ?? `Must be exactly ${n} characters.`
  return (value: string): string | null => {
    if (value.length === 0) {
      return null
    }
    if (value.length !== n) {
      return errorMessage
    }
    return null
  }
}

/**
 * Fails when a non-empty value doesn't match `re`. No default message —
 * an arbitrary regex has no generic human-readable description, so the
 * caller must supply one.
 */
export function pattern(re: RegExp, message: string): Rule {
  return (value: string): string | null => {
    if (value.length === 0) {
      return null
    }
    if (!re.test(value)) {
      return message
    }
    return null
  }
}

// parseInt alone would accept "3.5" as 3 — guard against any non-integer
// characters so a fractional or otherwise malformed string is rejected,
// not silently truncated.
const INTEGER_STRING_PATTERN = /^-?\d+$/

/**
 * Fails when a non-empty value isn't a valid integer in [min, max].
 * Uses parseInt(value, 10) — callers pass raw string input from controlled
 * <input> elements, never pre-parsed numbers.
 */
export function intInRange(min: number, max: number, message?: string): Rule {
  const errorMessage = message ?? `Must be a whole number between ${min} and ${max}.`
  return (value: string): string | null => {
    if (value.length === 0) {
      return null
    }
    if (!INTEGER_STRING_PATTERN.test(value.trim())) {
      return errorMessage
    }
    const parsed = parseInt(value, 10)
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
      return errorMessage
    }
    return null
  }
}
