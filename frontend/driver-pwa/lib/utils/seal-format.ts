// Mirrors backend _validate_seal_format (backend/app/schemas/phases.py): the API
// rejects any departure/unloading seal number not matching XX-#### with a 422.
// Validating up front means the driver hears about a bad seal at the input step, not
// via a raw 422 toast at the end-of-handshake submit after all photos are already taken.
const SEAL_FORMAT = /^[A-Z]{2}-\d{4}$/

// Callers must store this normalized value, not the raw keystrokes — isValidSealFormat
// validates the normalized form, so a component that trims/uppercases only for the
// check but submits the raw input can pass its own gate and still 422 on submit (a
// leading/trailing space survives toUpperCase() but not the backend's untrimmed regex).
export function normalizeSeal(value: string): string {
  return value.trim().toUpperCase()
}

export function isValidSealFormat(value: string): boolean {
  return SEAL_FORMAT.test(normalizeSeal(value))
}
