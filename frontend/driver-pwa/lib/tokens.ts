// Raw palette values for the places Tailwind classes cannot reach (canvas drawing —
// ctx.fillStyle takes a colour string, not a class name). Must stay in step with the
// hex scale in tailwind.config.ts — same palette, reached a different way.

// Re-exported (not just moved) so existing importers in this app are untouched.
export { ATTESTATION_CANVAS_COLOURS } from '@shared/lib/constants/attestation-colours'

/**
 * The QR code's own two colours. Not from the palette, and deliberately not
 * theme-aware — a QR is decoded by a camera, and themed greys can fail to scan.
 */
export const QR_CANVAS_COLOURS = {
  dark: '#000000',
  light: '#ffffff',
} as const
