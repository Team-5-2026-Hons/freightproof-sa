// frontend/receiver/lib/consent.ts
//
// The consent wording, in ONE place, because its SHA-256 is stored as evidence.
//
// This wording carries TWO legal loads at once, and both depend on it being accurate:
//
//   * POPIA s27(1)(a) — explicit consent, the exemption that makes biometric processing
//     lawful at all, since s26 otherwise prohibits it.
//   * POPIA s72(1)(b) — the data subject's consent to their personal information being
//     transferred outside South Africa. This is why the text names the transfer
//     explicitly rather than only naming the provider: a receiver who is not told the
//     data leaves the country has not consented to it leaving the country.
//
// The server hashes this exact string and stores the digest — so editing this text changes
// the hash, and a dispute months later can tell which version a given receiver saw.
//
// Consent is only valid if refusing is real. Declining is a visible button on the consent
// screen and the delivery still confirms without the check; if that ever stops being true,
// this consent stops being worth anything.
//
// Treat it as versioned content, not a UI string. If you change the wording, change
// CONSENT_VERSION with it so the two never drift.

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
