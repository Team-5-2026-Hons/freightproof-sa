// Slippy-map tile arithmetic for the precinct static map thumbnail.
//
// Pure and unit-tested on purpose: this only computes which tile images to
// request and where to position a geofence marker inside them. No React, no
// DOM, no fetch — components layer on top of this.

/** Standard OSM/Google/MapBox slippy-map tile size; every tile provider this app uses is 256x256. */
export const TILE_SIZE_PX = 256

/** Ground resolution (metres/pixel) at the equator, zoom 0 — the constant baked into the Web Mercator tile spec. */
export const EQUATOR_METRES_PER_PIXEL_Z0 = 156543.03392

/** Below this the thumbnail is too coarse to show a useful geofence context. */
export const MIN_TILE_ZOOM = 10

/** OSM's standard raster tile set stops serving useful detail beyond this. */
export const MAX_TILE_ZOOM = 18

/** Target fraction of the card's width the geofence circle should occupy when auto-picking a zoom. */
export const FENCE_FRACTION_OF_CARD = 0.55

/** Mid-range fallback zoom for radius inputs that can't drive the log2 search (0, negative, NaN). */
const DEFAULT_TILE_ZOOM = 14

/** Web Mercator is only defined up to this latitude before y runs to +/-Infinity. */
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

/**
 * Fractional slippy-map tile coordinates for a lat/lng at a given zoom.
 *
 * This is the standard Web Mercator projection formula that OSM, Google and
 * every other XYZ tile provider address their tiles by — not an approximation
 * we chose, it's the coordinate system the tile server expects.
 */
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
 * Integer zoom level that renders a geofence circle at roughly
 * FENCE_FRACTION_OF_CARD of the card's width.
 *
 * Solved in closed form rather than by iterating zoom levels: circle diameter
 * in pixels is monotonic in zoom (metresPerPixel halves each level), so
 * diameter(z) = target can be inverted directly via log2 instead of searching.
 */
export function zoomForRadius(radiusMetres: number, latitude: number, cardWidthPx: number): number {
  if (!Number.isFinite(radiusMetres) || radiusMetres <= 0) {
    return DEFAULT_TILE_ZOOM
  }

  const targetDiameterPx = FENCE_FRACTION_OF_CARD * cardWidthPx
  const latRad = toRadians(clampLatitude(latitude))
  // Guard cos() rounding to 0 at the poles, which would send log2 to -Infinity.
  const cosLat = Math.max(Math.abs(Math.cos(latRad)), Number.EPSILON)

  const exactZoom = Math.log2(
    (targetDiameterPx * EQUATOR_METRES_PER_PIXEL_Z0 * cosLat) / (2 * radiusMetres),
  )

  if (!Number.isFinite(exactZoom)) {
    return DEFAULT_TILE_ZOOM
  }

  return clampZoom(Math.round(exactZoom))
}

/**
 * OSM raster tile URL template, in the `{z}/{x}/{y}` placeholder form Leaflet consumes
 * directly. Single fixed host, not the deprecated `{s}` subdomain form.
 *
 * The one place the tile provider is named. Moving off OSM's donated infrastructure to
 * a host with an actual usage agreement (MapTiler, Stadia, Carto) is meant to be this
 * constant plus a key — so both the static thumbnail and `GeofenceMap` read it from
 * here rather than each carrying its own copy of the URL.
 */
export const OSM_TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'

/** OSM raster tile URL for a tile coordinate. Uses a single fixed host, not the deprecated {s} subdomain form. */
export function tileUrl(x: number, y: number, zoom: number): string {
  return OSM_TILE_URL_TEMPLATE.replace('{z}', String(zoom))
    .replace('{x}', String(Math.floor(x)))
    .replace('{y}', String(Math.floor(y)))
}

/** One tile to render, with its pixel offset inside the viewport box. */
export interface TilePlacement {
  /** Tile column, already wrapped into [0, 2^zoom) so it is safe to request. */
  x: number
  /** Tile row, always within [0, 2^zoom) — rows off the top/bottom of the world are omitted. */
  y: number
  /** Pixel offset of this tile's left edge from the viewport box's left edge. */
  left: number
  /** Pixel offset of this tile's top edge from the viewport box's top edge. */
  top: number
}

/**
 * Every tile needed to fully cover a `widthPx` x `heightPx` viewport centred on a
 * lat/lng, with the pixel offset each one must be positioned at.
 *
 * Works in global pixel space (tile coordinate x TILE_SIZE_PX) rather than by
 * translating a fixed NxN block, because a fixed block is not sufficient: the block is
 * offset by the centre's fractional position within its own tile, so a viewport wider
 * than one tile can need either 2 or 3 columns depending on where in the tile the
 * precinct happens to fall. Deriving the range from the box's own edges is correct for
 * every offset instead of for the lucky ones, and costs at most two extra images.
 *
 * Columns wrap at the antimeridian (tile 0 follows tile 2^zoom - 1). Rows do not wrap —
 * there is no tile above the north pole — so out-of-range rows are omitted and the
 * caller's background shows through.
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

  // Global pixel coordinates of the viewport's top-left corner at this zoom.
  //
  // Rounded to whole pixels so every tile lands on an integer offset. Adjacent tiles
  // placed at fractional offsets render with hairline seams between them on many
  // browsers — visible as a grid drawn over the map. Rounding the shared origin keeps
  // the tiles aligned to each other and shifts the whole image by at most half a pixel,
  // which is well under the precision any of this is read at. (Leaflet rounds its own
  // tile positions for the same reason.)
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
