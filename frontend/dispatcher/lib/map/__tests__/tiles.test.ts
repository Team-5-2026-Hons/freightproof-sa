import { describe, expect, it } from 'vitest'
import {
  MAX_TILE_ZOOM,
  MIN_TILE_ZOOM,
  TILE_SIZE_PX,
  metresPerPixel,
  tileCoordinates,
  tileGrid,
  tileUrl,
  zoomForRadius,
} from '../tiles'

// Two known South African precincts, verified against an independent slippy-map
// tile calculator so a projection sign/rounding error can't sneak past a
// self-consistent test.
const BLOEMFONTEIN = { lat: -29.0852, lng: 26.1596 }
const DURBAN = { lat: -29.7942, lng: 30.982 }

// Card width used by the precinct list card that this module backs the thumbnail for.
const CARD_WIDTH_PX = 280

describe('tileCoordinates', () => {
  it('places Bloemfontein at z16 tile x=37530, y=38306', () => {
    const { x, y } = tileCoordinates(BLOEMFONTEIN.lat, BLOEMFONTEIN.lng, 16)

    expect(Math.floor(x)).toBe(37530)
    expect(Math.floor(y)).toBe(38306)
    expect(x).toBeCloseTo(37530.21, 1)
    expect(y).toBeCloseTo(38306.05, 1)
  })

  it('places Durban at z16 tile x=38408, y=38454', () => {
    const { x, y } = tileCoordinates(DURBAN.lat, DURBAN.lng, 16)

    expect(Math.floor(x)).toBe(38408)
    expect(Math.floor(y)).toBe(38454)
    expect(x).toBeCloseTo(38408.1, 1)
    expect(y).toBeCloseTo(38454.26, 1)
  })

  it('returns a fractional part in [0, 1) for x and y, so a pixel offset stays within one tile', () => {
    const { x, y } = tileCoordinates(BLOEMFONTEIN.lat, BLOEMFONTEIN.lng, 16)
    const fracX = x - Math.floor(x)
    const fracY = y - Math.floor(y)

    expect(fracX).toBeGreaterThanOrEqual(0)
    expect(fracX).toBeLessThan(1)
    expect(fracY).toBeGreaterThanOrEqual(0)
    expect(fracY).toBeLessThan(1)
  })

  it('does not produce NaN or a negative index at the antimeridian', () => {
    const atPositive180 = tileCoordinates(0, 180, 10)
    const atNegative180 = tileCoordinates(0, -180, 10)

    expect(Number.isNaN(atPositive180.x)).toBe(false)
    expect(Number.isNaN(atPositive180.y)).toBe(false)
    expect(atPositive180.x).toBeGreaterThanOrEqual(0)
    expect(atNegative180.x).toBeGreaterThanOrEqual(0)
    expect(atNegative180.y).toBeGreaterThanOrEqual(0)
  })

  it('does not produce NaN or a negative index near the Mercator projection limit', () => {
    const nearNorthPole = tileCoordinates(89.9, 0, 10)
    const nearSouthPole = tileCoordinates(-89.9, 0, 10)

    expect(Number.isNaN(nearNorthPole.y)).toBe(false)
    expect(Number.isNaN(nearSouthPole.y)).toBe(false)
    expect(nearNorthPole.y).toBeGreaterThanOrEqual(0)
    expect(nearSouthPole.y).toBeGreaterThanOrEqual(0)
  })
})

describe('metresPerPixel', () => {
  it('is approximately 2.087 at Bloemfontein z16', () => {
    expect(metresPerPixel(BLOEMFONTEIN.lat, 16)).toBeCloseTo(2.087, 2)
  })

  it('is always positive', () => {
    expect(metresPerPixel(-89.9, 12)).toBeGreaterThan(0)
    expect(metresPerPixel(0, 12)).toBeGreaterThan(0)
    expect(metresPerPixel(89.9, 12)).toBeGreaterThan(0)
  })

  it('strictly decreases as zoom increases, for a fixed latitude', () => {
    for (let zoom = MIN_TILE_ZOOM; zoom < MAX_TILE_ZOOM; zoom++) {
      expect(metresPerPixel(BLOEMFONTEIN.lat, zoom + 1)).toBeLessThan(
        metresPerPixel(BLOEMFONTEIN.lat, zoom),
      )
    }
  })
})

describe('zoomForRadius', () => {
  it('picks zoom 16 for a 200m geofence', () => {
    expect(zoomForRadius(200, BLOEMFONTEIN.lat, CARD_WIDTH_PX)).toBeGreaterThanOrEqual(15)
    expect(zoomForRadius(200, BLOEMFONTEIN.lat, CARD_WIDTH_PX)).toBeLessThanOrEqual(17)
  })

  it('picks zoom 18 for a 50m geofence', () => {
    expect(zoomForRadius(50, BLOEMFONTEIN.lat, CARD_WIDTH_PX)).toBe(MAX_TILE_ZOOM)
  })

  it('picks zoom 11 for a 5000m geofence', () => {
    expect(zoomForRadius(5000, BLOEMFONTEIN.lat, CARD_WIDTH_PX)).toBeGreaterThanOrEqual(10)
    expect(zoomForRadius(5000, BLOEMFONTEIN.lat, CARD_WIDTH_PX)).toBeLessThanOrEqual(12)
  })

  it('is directionally correct: smaller radius maps to a higher (or equal) zoom', () => {
    const zoomSmall = zoomForRadius(50, BLOEMFONTEIN.lat, CARD_WIDTH_PX)
    const zoomLarge = zoomForRadius(5000, BLOEMFONTEIN.lat, CARD_WIDTH_PX)

    expect(zoomSmall).toBeGreaterThanOrEqual(zoomLarge)
  })

  it('clamps to [MIN_TILE_ZOOM, MAX_TILE_ZOOM] for any finite radius', () => {
    expect(zoomForRadius(0.001, BLOEMFONTEIN.lat, CARD_WIDTH_PX)).toBeLessThanOrEqual(MAX_TILE_ZOOM)
    expect(zoomForRadius(1_000_000, BLOEMFONTEIN.lat, CARD_WIDTH_PX)).toBeGreaterThanOrEqual(
      MIN_TILE_ZOOM,
    )
  })

  it('falls back to a sane in-range zoom for zero, negative, and NaN radii', () => {
    for (const radius of [0, -50, Number.NaN]) {
      const zoom = zoomForRadius(radius, BLOEMFONTEIN.lat, CARD_WIDTH_PX)

      expect(Number.isNaN(zoom)).toBe(false)
      expect(zoom).toBeGreaterThanOrEqual(MIN_TILE_ZOOM)
      expect(zoom).toBeLessThanOrEqual(MAX_TILE_ZOOM)
    }
  })
})

describe('tileUrl', () => {
  it('builds an OSM tile URL from floored integer coordinates', () => {
    expect(tileUrl(37530.7, 38306.2, 16)).toBe('https://tile.openstreetmap.org/16/37530/38306.png')
  })

  it('never uses the deprecated {s} subdomain form', () => {
    expect(tileUrl(0, 0, 10)).not.toContain('{s}')
  })
})

describe('tileGrid', () => {
  const WIDTH_PX = 280
  const HEIGHT_PX = 150

  /** Total pixel span the returned tiles occupy, relative to the viewport box. */
  function coverage(tiles: ReturnType<typeof tileGrid>) {
    const left = Math.min(...tiles.map((t) => t.left))
    const top = Math.min(...tiles.map((t) => t.top))
    const right = Math.max(...tiles.map((t) => t.left + TILE_SIZE_PX))
    const bottom = Math.max(...tiles.map((t) => t.top + TILE_SIZE_PX))
    return { left, top, right, bottom }
  }

  // The regression this function exists for: a fixed 2x2 block is offset by the centre's
  // fractional position inside its own tile, so for most coordinates it left a blank
  // strip down the side of the thumbnail. Bloemfontein, Johannesburg and Durban all
  // failed that way at their derived zooms; Cape Town happened not to.
  it.each([
    ['Bloemfontein', BLOEMFONTEIN.lat, BLOEMFONTEIN.lng, 200],
    ['Durban', DURBAN.lat, DURBAN.lng, 300],
    ['Cape Town', -33.8651, 18.5127, 50],
    ['Johannesburg', -26.0942, 28.1342, 5000],
    ['equator/prime meridian', 0, 0, 200],
  ])('fully covers the viewport for %s', (_name, lat, lng, radius) => {
    const zoom = zoomForRadius(radius, lat, WIDTH_PX)
    const tiles = tileGrid(lat, lng, zoom, WIDTH_PX, HEIGHT_PX)
    const { left, top, right, bottom } = coverage(tiles)

    expect(left).toBeLessThanOrEqual(0)
    expect(top).toBeLessThanOrEqual(0)
    expect(right).toBeGreaterThanOrEqual(WIDTH_PX)
    expect(bottom).toBeGreaterThanOrEqual(HEIGHT_PX)
  })

  it('covers the viewport at every fractional tile offset, not just lucky ones', () => {
    // Sweep longitude across a whole tile at z16 so every possible fractional x offset
    // is exercised — the case the old fixed-block version got wrong.
    const zoom = 16
    const degreesPerTile = 360 / 2 ** zoom

    for (let step = 0; step < 20; step++) {
      const lng = -180 + (step / 20) * degreesPerTile
      const tiles = tileGrid(BLOEMFONTEIN.lat, lng, zoom, WIDTH_PX, HEIGHT_PX)
      const { left, right } = coverage(tiles)

      expect(left).toBeLessThanOrEqual(0)
      expect(right).toBeGreaterThanOrEqual(WIDTH_PX)
    }
  })

  it('centres the requested coordinate in the viewport', () => {
    const zoom = 16
    const tiles = tileGrid(BLOEMFONTEIN.lat, BLOEMFONTEIN.lng, zoom, WIDTH_PX, HEIGHT_PX)
    const { x, y } = tileCoordinates(BLOEMFONTEIN.lat, BLOEMFONTEIN.lng, zoom)

    // The tile the point falls in, positioned by its own fractional offset, must place
    // that point at the box's centre — to within the half-pixel the origin rounding
    // (which exists to avoid seams between tiles) can move it.
    const centreTile = tiles.find((t) => t.x === Math.floor(x) && t.y === Math.floor(y))
    expect(centreTile).toBeDefined()
    expect(centreTile!.left + (x - Math.floor(x)) * TILE_SIZE_PX).toBeCloseTo(WIDTH_PX / 2, 0)
    expect(centreTile!.top + (y - Math.floor(y)) * TILE_SIZE_PX).toBeCloseTo(HEIGHT_PX / 2, 0)
  })

  it('places every tile on a whole pixel, so no seams show between them', () => {
    const tiles = tileGrid(DURBAN.lat, DURBAN.lng, 16, WIDTH_PX, HEIGHT_PX)

    tiles.forEach((tile) => {
      expect(Number.isInteger(tile.left)).toBe(true)
      expect(Number.isInteger(tile.top)).toBe(true)
    })
  })

  it('wraps tile columns at the antimeridian instead of requesting a negative index', () => {
    const zoom = 10
    const tiles = tileGrid(0, -180, zoom, WIDTH_PX, HEIGHT_PX)

    expect(tiles.length).toBeGreaterThan(0)
    tiles.forEach((tile) => {
      expect(tile.x).toBeGreaterThanOrEqual(0)
      expect(tile.x).toBeLessThan(2 ** zoom)
    })
    // The wrap actually happened: tiles from both edges of the world are present.
    expect(tiles.some((t) => t.x === 2 ** zoom - 1)).toBe(true)
  })

  it('omits rows off the top and bottom of the world rather than requesting them', () => {
    const zoom = 10
    const tiles = tileGrid(85.05, 0, zoom, WIDTH_PX, HEIGHT_PX)

    tiles.forEach((tile) => {
      expect(tile.y).toBeGreaterThanOrEqual(0)
      expect(tile.y).toBeLessThan(2 ** zoom)
    })
  })

  it('returns no tiles for a zero or non-finite viewport, rather than throwing', () => {
    expect(tileGrid(BLOEMFONTEIN.lat, BLOEMFONTEIN.lng, 16, 0, HEIGHT_PX)).toEqual([])
    expect(tileGrid(BLOEMFONTEIN.lat, BLOEMFONTEIN.lng, 16, WIDTH_PX, 0)).toEqual([])
    expect(tileGrid(BLOEMFONTEIN.lat, BLOEMFONTEIN.lng, 16, Number.NaN, HEIGHT_PX)).toEqual([])
  })

  it('requests every tile at most once', () => {
    const tiles = tileGrid(DURBAN.lat, DURBAN.lng, 16, WIDTH_PX, HEIGHT_PX)
    const keys = new Set(tiles.map((t) => `${t.x}/${t.y}`))

    expect(keys.size).toBe(tiles.length)
  })
})
