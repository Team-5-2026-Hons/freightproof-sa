// Pure, dependency-free validation rule primitives. Each rule is a factory returning a
// `(value: string) => string | null` checker (null = valid), composable so form-specific
// validators (e.g. vehicle.ts) can chain them per field.
// Framework-agnostic on purpose — consumed via @shared/* by both Next.js apps.

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

/** Fails when value.length exceeds `n`. Empty values are skipped — compose with `required` separately. */
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

/** Fails when a non-empty value's length isn't exactly `n` (e.g. VIN). Empty values are skipped. */
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

/** Fails when a non-empty value doesn't match `re`. No default message — the caller must supply one. */
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

// parseInt alone would accept "3.5" as 3 — guard against non-integer characters so a
// fractional string is rejected, not silently truncated.
const INTEGER_STRING_PATTERN = /^-?\d+$/

/** Fails when a non-empty value isn't a valid integer in [min, max]. */
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

const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d+)?$/

/** Fails when a non-empty value isn't a decimal number within [min, max] (e.g. GPS coordinates). */
export function decimalInRange(min: number, max: number, message?: string): Rule {
  const errorMessage = message ?? `Must be a number between ${min} and ${max}.`
  return (value: string): string | null => {
    if (value.length === 0) {
      return null
    }
    if (!DECIMAL_STRING_PATTERN.test(value.trim())) {
      return errorMessage
    }
    const parsed = parseFloat(value)
    if (Number.isNaN(parsed) || parsed < min || parsed > max) {
      return errorMessage
    }
    return null
  }
}
