// Mirrors backend _validate_seal_format (backend/app/schemas/handshakes.py): the API
// rejects any H2/H4 seal number not matching XX-#### with a 422. Validating up front
// means the driver hears about a bad seal at the input step, not via a raw 422 toast
// at the end-of-handshake submit after all photos are already taken.
const SEAL_FORMAT = /^[A-Z]{2}-\d{4}$/

export function isValidSealFormat(value: string): boolean {
  return SEAL_FORMAT.test(value.trim().toUpperCase())
}
