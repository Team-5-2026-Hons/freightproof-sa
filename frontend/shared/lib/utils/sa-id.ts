// Shape check only, never a submission gate: a wrong-looking value is itself evidence
// (foreign passport, company reg, mistyped digit), so no Luhn/checksum here on purpose.
// Mirrors DepartureCompleteRequest.seal_number_confirmed in backend/app/schemas/phases.py.

/** SA ID numbers are exactly 13 digits (YYMMDD SSSS C A Z). */
const SA_ID_DIGIT_COUNT = 13

const SA_ID_PATTERN = new RegExp(`^\\d{${SA_ID_DIGIT_COUNT}}$`)

/** Whether `value` has the shape of a South African ID number (hint only, never a submission gate). */
export function looksLikeSaIdNumber(value: string): boolean {
  return SA_ID_PATTERN.test(value.trim())
}

/** Whether the receiver has supplied an identity at all — this gates the signing swipe. */
export function hasRecipientIdentity(name: string | null, idNumber: string | null): boolean {
  return (name ?? '').trim().length > 0 && (idNumber ?? '').trim().length > 0
}
