// Shape check for a South African ID number, used to HINT and never to block.
//
// The receiver signing for a delivery is not always an SA ID holder: a foreign driver's
// passport number, a company registration number, or a genuinely mistyped digit all have
// to be recordable. On an evidence platform a wrong-looking value is itself evidence —
// refusing to store it destroys the record of what the receiver actually presented.
//
// This mirrors the precedent already set backend-side, where
// DepartureCompleteRequest.seal_number_confirmed is deliberately free-form for the same
// reason: "a mistyped confirmation is itself evidence of a mismatch and must be
// recordable, not 422'd away" (backend/app/schemas/phases.py).
//
// Consequently there is no Luhn/checksum validation here on purpose. A checksum would
// tempt a caller into treating a `false` as grounds to reject, which is exactly the
// behaviour this module exists to avoid.

/** SA ID numbers are exactly 13 digits (YYMMDD SSSS C A Z). */
const SA_ID_DIGIT_COUNT = 13

const SA_ID_PATTERN = new RegExp(`^\\d{${SA_ID_DIGIT_COUNT}}$`)

/**
 * Whether `value` has the shape of a South African ID number.
 *
 * Callers must use this to decide whether to show an advisory hint, never to gate
 * submission. Whitespace is trimmed first so a trailing space from a phone keyboard
 * doesn't produce a misleading hint.
 */
export function looksLikeSaIdNumber(value: string): boolean {
  return SA_ID_PATTERN.test(value.trim())
}

/**
 * Whether the receiver has supplied an identity at all.
 *
 * This IS a gate: it is what arms the signing swipe. It asks only that both fields are
 * non-empty, which is a different and much weaker question than whether the ID number
 * looks well-formed.
 */
export function hasRecipientIdentity(name: string | null, idNumber: string | null): boolean {
  return (name ?? '').trim().length > 0 && (idNumber ?? '').trim().length > 0
}
