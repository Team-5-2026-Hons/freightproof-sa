// Mirrors backend _validate_seal_format: the API 422s any seal not matching XX-####.
// Validating up front surfaces a bad seal at the input step, not a raw 422 at submit.
const SEAL_FORMAT = /^[A-Z]{2}-\d{4}$/

export function normalizeSeal(value: string): string {
  return value.trim().toUpperCase()
}

export function isValidSealFormat(value: string): boolean {
  return SEAL_FORMAT.test(normalizeSeal(value))
}
