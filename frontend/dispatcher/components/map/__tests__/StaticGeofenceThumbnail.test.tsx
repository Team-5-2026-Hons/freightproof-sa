import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { TILE_SIZE_PX, metresPerPixel, tileGrid, zoomForRadius } from '@/lib/map/tiles'

import { DEFAULT_THUMBNAIL_WIDTH_PX, StaticGeofenceThumbnail } from '../StaticGeofenceThumbnail'

// Fixed fixture coordinates (Cape Town CBD) so the expected tile z/x/y can be computed
// independently in this test without duplicating the component's own maths.
const LATITUDE = -33.9249
const LONGITUDE = 18.4241
const RADIUS_METRES = 200
const PRECINCT_NAME = 'V&A Waterfront Yard'

const TILE_URL_PATTERN = /^https:\/\/tile\.openstreetmap\.org\/(\d+)\/(\d+)\/(\d+)\.png$/

// jsdom has no ResizeObserver, so the component renders at its default width — which is
// exactly the width these expectations are computed against.
const EXPECTED_WIDTH_PX = DEFAULT_THUMBNAIL_WIDTH_PX
const EXPECTED_HEIGHT_PX = 150

function renderThumbnail(radiusMetres = RADIUS_METRES) {
  return render(
    <StaticGeofenceThumbnail
      latitude={LATITUDE}
      longitude={LONGITUDE}
      radiusMetres={radiusMetres}
      name={PRECINCT_NAME}
    />,
  )
}

/** The tile `<img>` elements, which are unlabelled by design (see the alt-text test). */
function tileImages(): HTMLImageElement[] {
  const container = screen.getByRole('img', { name: `Street map showing ${PRECINCT_NAME}` })
  return Array.from(container.querySelectorAll('img'))
}

describe('StaticGeofenceThumbnail', () => {
  it('renders OSM tiles at the zoom derived from the geofence radius', () => {
    renderThumbnail()

    const zoom = zoomForRadius(RADIUS_METRES, LATITUDE, EXPECTED_WIDTH_PX)
    const images = tileImages()
    expect(images.length).toBeGreaterThan(0)

    images.forEach((img) => {
      const match = TILE_URL_PATTERN.exec(img.getAttribute('src') ?? '')
      expect(match).not.toBeNull()
      expect(Number((match as RegExpExecArray)[1])).toBe(zoom)
    })
  })

  // The bug this guards: a fixed 2x2 tile block is offset by the centre's fractional
  // position within its own tile, so for most coordinates it left a blank strip down
  // the side of the card — the grey void the schematic fallback exists to prevent, but
  // reached without any tile actually failing.
  it('renders enough tiles to cover the whole thumbnail, leaving no blank strip', () => {
    renderThumbnail()

    const images = tileImages()
    const lefts = images.map((img) => parseFloat(img.style.left))
    const tops = images.map((img) => parseFloat(img.style.top))

    expect(Math.min(...lefts)).toBeLessThanOrEqual(0)
    expect(Math.min(...tops)).toBeLessThanOrEqual(0)
    expect(Math.max(...lefts) + TILE_SIZE_PX).toBeGreaterThanOrEqual(EXPECTED_WIDTH_PX)
    expect(Math.max(...tops) + TILE_SIZE_PX).toBeGreaterThanOrEqual(EXPECTED_HEIGHT_PX)
  })

  it('positions every tile exactly where the pure tileGrid maths says it goes', () => {
    renderThumbnail()

    const zoom = zoomForRadius(RADIUS_METRES, LATITUDE, EXPECTED_WIDTH_PX)
    const expected = tileGrid(LATITUDE, LONGITUDE, zoom, EXPECTED_WIDTH_PX, EXPECTED_HEIGHT_PX)
    const images = tileImages()

    expect(images).toHaveLength(expected.length)
    expected.forEach((tile) => {
      const img = images.find((candidate) =>
        (candidate.getAttribute('src') ?? '').endsWith(`/${zoom}/${tile.x}/${tile.y}.png`),
      )
      expect(img).toBeDefined()
      expect(parseFloat(img!.style.left)).toBeCloseTo(tile.left, 4)
      expect(parseFloat(img!.style.top)).toBeCloseTo(tile.top, 4)
    })
  })

  it('draws the geofence circle to scale for the derived zoom', () => {
    const { container } = renderThumbnail()

    const zoom = zoomForRadius(RADIUS_METRES, LATITUDE, EXPECTED_WIDTH_PX)
    const expectedRadiusPx = RADIUS_METRES / metresPerPixel(LATITUDE, zoom)

    const circle = container.querySelector('[data-testid="thumbnail-fence-circle"]')
    expect(circle).not.toBeNull()
    expect(Number(circle?.getAttribute('r'))).toBeCloseTo(expectedRadiusPx, 1)
  })

  it('re-frames the map when the radius changes, rather than only resizing the circle', () => {
    const { rerender, container } = render(
      <StaticGeofenceThumbnail
        latitude={LATITUDE}
        longitude={LONGITUDE}
        radiusMetres={50}
        name={PRECINCT_NAME}
      />,
    )
    const tightZoom = TILE_URL_PATTERN.exec(
      container.querySelector('img')?.getAttribute('src') ?? '',
    )?.[1]

    rerender(
      <StaticGeofenceThumbnail
        latitude={LATITUDE}
        longitude={LONGITUDE}
        radiusMetres={5000}
        name={PRECINCT_NAME}
      />,
    )
    const wideZoom = TILE_URL_PATTERN.exec(
      container.querySelector('img')?.getAttribute('src') ?? '',
    )?.[1]

    expect(Number(tightZoom)).toBeGreaterThan(Number(wideZoom))
  })

  it('falls back to GeofenceSchematic when any tile fails to load', () => {
    renderThumbnail()

    fireEvent.error(tileImages()[0])

    expect(screen.queryByTestId('thumbnail-fence-circle')).not.toBeInTheDocument()
    expect(screen.getByTestId('schematic-fence-circle')).toBeInTheDocument()
  })

  it('labels the map once on its container, not once per tile fragment', () => {
    renderThumbnail()

    // One accessible name for the whole map — the tiles are fragments of a single
    // image, so labelling each would make a screen reader announce the precinct once
    // per tile.
    const container = screen.getByRole('img', { name: `Street map showing ${PRECINCT_NAME}` })
    expect(within(container).queryAllByRole('img')).toHaveLength(0)

    tileImages().forEach((img) => {
      expect(img.getAttribute('alt')).toBe('')
    })
  })

  it('loads every tile lazily and asynchronously', () => {
    renderThumbnail()

    tileImages().forEach((img) => {
      expect(img.getAttribute('loading')).toBe('lazy')
      expect(img.getAttribute('decoding')).toBe('async')
    })
  })
})
