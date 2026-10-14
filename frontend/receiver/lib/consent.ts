// Consent wording lives in ONE place because its SHA-256 is stored as evidence: editing
// this text changes the hash, so a dispute later can tell which version a receiver saw.
// Satisfies POPIA s27(1)(a) (explicit consent for biometric processing) and s72(1)(b)
// (consent to cross-border transfer — the transfer must be named explicitly, not just the
// provider). If you change the wording, bump CONSENT_VERSION so the two never drift.

export const CONSENT_VERSION = 'v2'

export const CONSENT_TEXT = [
  'To confirm this delivery we need to check your identity.',
  'You will be asked to photograph an identity document and take a photograph of your face.',
  'These images are sent to our verification provider, Didit, and are processed on servers',
  'outside South Africa. They are not stored by FreightProof.',
  'We keep only the result of the check, the time, and a reference number.',
  'You can decline. The delivery can still be confirmed without this check.',
].join(' ')

/** What the server hashes. Kept separate so the version travels with the wording. */
export function consentPayloadText(): string {
  return `${CONSENT_VERSION}: ${CONSENT_TEXT}`
}
