// frontend/driver-pwa/lib/tokens.ts
//
// Raw palette values for the places Tailwind classes cannot reach.
//
// eslint.config.mjs bans hex literals everywhere except this file and tailwind.config.ts
// (see DESIGN_SYSTEM.md §2.3), because component styling belongs in the token map. Canvas
// drawing is the exception the rule anticipates: ctx.fillStyle takes a colour string, not
// a class name, so a canvas-rendered artifact has no way to consume a Tailwind token.
//
// Values are copied from the hex scale in tailwind.config.ts and must stay in step with
// it — they are the same palette, reached a different way.

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
