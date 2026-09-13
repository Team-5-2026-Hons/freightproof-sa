// Canvas colours for the rendered POD attestation.
//
// Moved here from driver-pwa/lib/tokens.ts (2026-09-13, FP-155): the attestation is now
// drawn by the RECEIVER's browser (frontend/receiver) as well as being read by the
// driver app, and two copies of these values would let one surface drift into producing
// a different-looking document for the same evidence type.

/**
 * Palette for the POD attestation image (lib/utils/render-attestation.ts).
 *
 * Deliberately the light-surface values regardless of the device theme: this is a
 * document that gets exported, printed and read in a dispute, not a screen that follows
 * the driver's dark-mode preference.
 */
export const ATTESTATION_CANVAS_COLOURS = {
  /** surf-lowest — the document ground. */
  background: '#ffffff',
  /** on-surf — headings and values. */
  title: '#1b1b1c',
  /** on-surf-v — field labels, one step back from the values they describe. */
  label: '#46464f',
  /** outline.v — the rule under the title. */
  rule: '#c7c6ca',
} as const
