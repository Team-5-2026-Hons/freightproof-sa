// frontend/receiver/lib/consent.ts
//
// The consent wording, in ONE place, because its SHA-256 is stored as evidence.
//
// POPIA s27(1)(a) is the exemption that makes a biometric identity check lawful here, and
// that exemption is only as good as proof of what the receiver actually agreed to. The
// server hashes this exact string and stores the digest — so editing this text changes the
// hash, and a dispute months later can tell which version a given receiver saw.
//
// Treat it as versioned content, not a UI string. If you change the wording, change
// CONSENT_VERSION with it so the two never drift.

export const CONSENT_VERSION = 'v1'

export const CONSENT_TEXT = [
  'To confirm this delivery we need to check your identity.',
  'You will be asked to photograph an identity document and take a photograph of your face.',
  'These images are sent to our verification provider, Didit, and are not stored by FreightProof.',
  'We keep only the result of the check, the time, and a reference number.',
  'You can decline. The delivery can still be confirmed without this check.',
].join(' ')

/** What the server hashes. Kept separate so the version travels with the wording. */
export function consentPayloadText(): string {
  return `${CONSENT_VERSION}: ${CONSENT_TEXT}`
}
