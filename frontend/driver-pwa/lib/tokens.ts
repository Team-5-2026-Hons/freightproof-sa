// Raw palette values for the places Tailwind classes cannot reach (canvas drawing —
// ctx.fillStyle takes a colour string, not a class name). Must stay in step with the
// hex scale in tailwind.config.ts — same palette, reached a different way.

/**
 * The QR code's own two colours. Not from the palette, and deliberately not
 * theme-aware — a QR is decoded by a camera, and themed greys can fail to scan.
 */
export const QR_CANVAS_COLOURS = {
  dark: '#000000',
  light: '#ffffff',
} as const

export const THEME_PREVIEW_CLASSES = {
  system: 'bg-[linear-gradient(90deg,#f3f3f3_50%,#1c1c1e_50%)]',
  light: 'bg-[#f3f3f3]',
  dark: 'bg-[#1c1c1e]',
} as const

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

export const MAP_STYLES_QUIET: google.maps.MapTypeStyle[] = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
]
