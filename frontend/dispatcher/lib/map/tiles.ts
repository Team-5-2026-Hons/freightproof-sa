// Slippy-map tile arithmetic for the precinct static map thumbnail. Pure and
// unit-tested: no React, no DOM, no fetch — components layer on top of this.

/** Standard OSM/Google/MapBox slippy-map tile size (256x256). */
export const TILE_SIZE_PX = 256

export const EQUATOR_METRES_PER_PIXEL_Z0 = 156543.03392

export const MIN_TILE_ZOOM = 10

export const MAX_TILE_ZOOM = 18

export const FENCE_FRACTION_OF_FRAME = 0.55

const DEFAULT_TILE_ZOOM = 14

const MERCATOR_MAX_LATITUDE_DEG = 85.0511

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** Clamp latitude into the Mercator-safe range so polar inputs don't produce NaN/Infinity. */
function clampLatitude(latitude: number): number {
  return Math.min(MERCATOR_MAX_LATITUDE_DEG, Math.max(-MERCATOR_MAX_LATITUDE_DEG, latitude))
}

/** Wrap longitude into [-180, 180) so +/-180 map to the same meridian instead of an out-of-range tile column. */
function wrapLongitude(longitude: number): number {
  return ((longitude + 180) % 360 + 360) % 360 - 180
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_TILE_ZOOM, Math.max(MIN_TILE_ZOOM, zoom))
}

/** Fractional slippy-map tile coordinates for a lat/lng at a given zoom (standard Web
 *  Mercator projection — the coordinate system every XYZ tile server expects). */
export function tileCoordinates(
  latitude: number,
  longitude: number,
  zoom: number,
): { x: number; y: number } {
  const tileCount = 2 ** zoom
  const latRad = toRadians(clampLatitude(latitude))
  const wrappedLng = wrapLongitude(longitude)

  const x = ((wrappedLng + 180) / 360) * tileCount
  const y =
    (0.5 - Math.log((1 + Math.sin(latRad)) / (1 - Math.sin(latRad))) / (4 * Math.PI)) * tileCount

  return { x, y }
}

/** Ground resolution in metres/pixel at a latitude and zoom. Always positive — direction doesn't matter for a scale. */
export function metresPerPixel(latitude: number, zoom: number): number {
  const latRad = toRadians(clampLatitude(latitude))
  return (EQUATOR_METRES_PER_PIXEL_Z0 * Math.abs(Math.cos(latRad))) / 2 ** zoom
}

/**
 * Integer zoom level that renders a geofence circle at roughly FENCE_FRACTION_OF_FRAME
 * of `framePx` (the SMALLER of the viewport's two dimensions).
 *
 * Solved in closed form via log2 rather than by iterating zoom levels, since circle
 * diameter in pixels is monotonic in zoom. Rounded to an integer zoom, so the drawn
 * radius lands within a factor of sqrt(2) of the target — tiles.test.ts asserts that's
 * still safe across realistic widths/radii/SA latitudes.
 */
export function zoomForRadius(radiusMetres: number, latitude: number, framePx: number): number {
  if (!Number.isFinite(radiusMetres) || radiusMetres <= 0) {
    return DEFAULT_TILE_ZOOM
  }

  const targetDiameterPx = FENCE_FRACTION_OF_FRAME * framePx
  const latRad = toRadians(clampLatitude(latitude))
  const cosLat = Math.max(Math.abs(Math.cos(latRad)), Number.EPSILON)

  const exactZoom = Math.log2(
    (targetDiameterPx * EQUATOR_METRES_PER_PIXEL_Z0 * cosLat) / (2 * radiusMetres),
  )

  if (!Number.isFinite(exactZoom)) {
    return DEFAULT_TILE_ZOOM
  }

  return clampZoom(Math.round(exactZoom))
}

export const TILE_ERROR_FALLBACK_THRESHOLD = 6

const OSM_PUBLIC_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

export const OSM_TILE_URL_TEMPLATE =
  process.env.NEXT_PUBLIC_TILE_URL || OSM_PUBLIC_TILE_URL

export const TILE_SOURCES = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Imagery &copy; Esri',
    maxZoom: 19,
  },
  street: {
    label: 'Street',
    url: OSM_TILE_URL_TEMPLATE,
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  },
} as const

export type TileSourceKey = keyof typeof TILE_SOURCES

/** OSM raster tile URL for a tile coordinate. Uses a single fixed host, not the deprecated {s} subdomain form. */
export function tileUrl(x: number, y: number, zoom: number): string {
  return OSM_TILE_URL_TEMPLATE.replace('{z}', String(zoom))
    .replace('{x}', String(Math.floor(x)))
    .replace('{y}', String(Math.floor(y)))
}

/** One tile to render, with its pixel offset inside the viewport box. */
export interface TilePlacement {
  x: number
  y: number
  left: number
  top: number
}

/**
 * Every tile needed to fully cover a `widthPx` x `heightPx` viewport centred on a
 * lat/lng, with the pixel offset each one must be positioned at.
 *
 * Works in global pixel space rather than a fixed NxN block, since the centre's
 * fractional offset within its own tile means a viewport can need 2 or 3 columns
 * depending on where the precinct falls — deriving the range from the box's edges
 * covers every offset. Columns wrap at the antimeridian; rows don't (no tile above
 * the pole), so out-of-range rows are omitted.
 */
export function tileGrid(
  latitude: number,
  longitude: number,
  zoom: number,
  widthPx: number,
  heightPx: number,
): TilePlacement[] {
  if (!Number.isFinite(widthPx) || !Number.isFinite(heightPx) || widthPx <= 0 || heightPx <= 0) {
    return []
  }

  const tileCount = 2 ** zoom
  const { x, y } = tileCoordinates(latitude, longitude, zoom)

  const originXPx = Math.round(x * TILE_SIZE_PX - widthPx / 2)
  const originYPx = Math.round(y * TILE_SIZE_PX - heightPx / 2)

  const firstColumn = Math.floor(originXPx / TILE_SIZE_PX)
  const lastColumn = Math.floor((originXPx + widthPx) / TILE_SIZE_PX)
  const firstRow = Math.floor(originYPx / TILE_SIZE_PX)
  const lastRow = Math.floor((originYPx + heightPx) / TILE_SIZE_PX)

  const placements: TilePlacement[] = []
  for (let row = firstRow; row <= lastRow; row++) {
    if (row < 0 || row >= tileCount) {
      continue
    }
    for (let column = firstColumn; column <= lastColumn; column++) {
      placements.push({
        x: ((column % tileCount) + tileCount) % tileCount,
        y: row,
        left: column * TILE_SIZE_PX - originXPx,
        top: row * TILE_SIZE_PX - originYPx,
      })
    }
  }
  return placements
}
