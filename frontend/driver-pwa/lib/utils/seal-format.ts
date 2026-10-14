// Mirrors backend _validate_seal_format: the API 422s any seal not matching XX-####.
// Validating up front surfaces a bad seal at the input step, not a raw 422 at submit.
const SEAL_FORMAT = /^[A-Z]{2}-\d{4}$/

// Callers must store this normalized value, not the raw keystrokes — a component that
// trims/uppercases only for the check but submits raw input can still 422 on submit.
export function normalizeSeal(value: string): string {
  return value.trim().toUpperCase()
}

export function isValidSealFormat(value: string): boolean {
  return SEAL_FORMAT.test(normalizeSeal(value))
}
