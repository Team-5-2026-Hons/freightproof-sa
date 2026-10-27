// Shared by driver-pwa and receiver, which both draw the attestation, so it can't drift
// into a different-looking document for the same evidence type.

/**
 * Palette for the POD attestation image (lib/utils/render-attestation.ts).
 * Deliberately light-surface regardless of device theme: this is an exported/printed
 * dispute document, not a screen that follows dark-mode.
 */
export const ATTESTATION_CANVAS_COLOURS = {
  background: '#ffffff',
  title: '#1b1b1c',
  label: '#46464f',
  rule: '#c7c6ca',
} as const
