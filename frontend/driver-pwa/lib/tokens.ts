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

/**
 * The Appearance tiles' miniature screens (components/settings/ThemeSelect). Literal
 * light and dark faces, not tokens: each tile shows what a choice LOOKS like, so it must
 * not change with the current theme. Kept as full class strings so Tailwind's content
 * scan (which includes lib/) emits them. System is split light|dark because it is both.
 */
export const THEME_PREVIEW_CLASSES = {
  system: 'bg-[linear-gradient(90deg,#f3f3f3_50%,#1c1c1e_50%)]',
  light: 'bg-[#f3f3f3]',
  dark: 'bg-[#1c1c1e]',
} as const

// Google Maps JS API styling for the dark theme. The basemap does not follow the app's
// theme on its own, so at night the map stayed a bright white panel in an otherwise dark
// screen — a glare source in a dark cab, the exact situation the dark theme exists for.
//
// Lives here, not in lib/constants: like the QR colours above, these are raw values for a
// surface Tailwind classes cannot reach, and this is the file the raw-hex lint rule exempts.
//
// Derived from Google's published "night" style, trimmed to the features a driving map
// shows. Values are the basemap's own palette, not app tokens: the Maps API takes literal
// colour strings and these tones are tuned for map legibility (roads lighter than land,
// water darker), not for UI surfaces.
export const MAP_STYLES_DARK: google.maps.MapTypeStyle[] = [
  { elementType: 'geometry', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#242f3e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#a5b0bd' }] },
  { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#8a96a3' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#263c3f' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#38414e' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#212a37' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#9ca5b3' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#746855' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1f2835' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#f3d19c' }] },
  { featureType: 'transit', elementType: 'geometry', stylers: [{ color: '#2f3948' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#17263c' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#515c6d' }] },
]

// Points of interest are noise on an evidence map: restaurant and school pins competed with
// the one thing the map is for — where the truck is. Applied in both themes, under the dark
// palette at night. Roads, place names and Google's attribution stay.
export const MAP_STYLES_QUIET: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
]
