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

// Moved to shared (2026-09-13, FP-155) — the receiver app renders the same document.
// Re-exported rather than deleted so existing importers in this app are untouched.
export { ATTESTATION_CANVAS_COLOURS } from '@shared/lib/constants/attestation-colours'

/**
 * The QR code's own two colours (FP-238).
 *
 * Not from the palette, and deliberately not theme-aware — the one place in this app
 * where that is correct. A QR is decoded by a camera, not read by a person: the spec's
 * contrast assumption is pure black modules on a pure white quiet zone, and rendering it
 * in themed greys produces a code that a phone in a dim warehouse simply fails to read.
 * Dark mode must not reach this.
 */
export const QR_CANVAS_COLOURS = {
  dark: '#000000',
  light: '#ffffff',
} as const
