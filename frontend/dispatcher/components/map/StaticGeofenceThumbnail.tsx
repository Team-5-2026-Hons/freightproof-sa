'use client'

import { useEffect, useRef, useState } from 'react'

import {
  TILE_ERROR_FALLBACK_THRESHOLD,
  TILE_SIZE_PX,
  metresPerPixel,
  tileGrid,
  tileUrl,
  zoomForRadius,
} from '@/lib/map/tiles'

import { GeofenceSchematic, SCALE_BAR_TARGET_FRACTION, niceScaleMetres } from './GeofenceSchematic'

// Width assumed until the element has actually been measured — server render, first
// paint, and any environment without ResizeObserver. Sized to a typical precinct card
// so the initially-chosen zoom is already close to the final one and the thumbnail does
// not visibly re-frame on mount.
export const DEFAULT_THUMBNAIL_WIDTH_PX = 280

// Fixed so the map band never grows/shrinks as tiles load progressively (which would
// otherwise shift every card below it on the list) — the thumbnail's job is a stable
// slot, not a resized one. Only the WIDTH is fluid: it follows the card, which is sized
// by a responsive grid and is therefore never a constant we could hardcode.
const THUMBNAIL_HEIGHT_PX = 150

// Distance in pixels of the scale bar's origin corner from the thumbnail's edges.
const SCALE_BAR_MARGIN_PX = 10

interface StaticGeofenceThumbnailProps {
  latitude: number
  longitude: number
  radiusMetres: number
  name: string
  className?: string
}

/**
 * Static street-map thumbnail for a precinct list card: OSM raster tiles composited to
 * look like one continuous map, centred on the precinct, with the geofence drawn to
 * scale as an SVG overlay.
 *
 * Deliberately plain `<img>` tiles rather than `next/image` or Leaflet: these are
 * already-optimally-sized 256px CDN-cached tiles from an external host, so proxying
 * them through Next's image optimizer would add a pointless server hop, and pulling in
 * Leaflet for a non-interactive thumbnail would cost a real dependency for a feature
 * `GeofenceMap` already owns. `GeofenceMap.tsx` remains the only file permitted to
 * import Leaflet.
 *
 * Falls back to `GeofenceSchematic` the instant any one tile fails to load — no grey
 * broken-image void, ever.
 */
export function StaticGeofenceThumbnail({
  latitude,
  longitude,
  radiusMetres,
  name,
  className,
}: StaticGeofenceThumbnailProps) {
  // A single flag, not per-tile tracking: one broken tile already breaks the illusion
  // of a continuous map, so there is no useful "partially working" state to render.
  // Counted, not latched. A single tile 404 at the edge of a coverage area is normal
  // and must not replace the map — only a RUN of failures with nothing loading between
  // them means the tile server is unreachable. Reset by any successful tile, so a
  // transient outage recovers on its own instead of stranding the card on the schematic
  // for the rest of the session. Same policy and same constant as GeofenceMap.
  const [tileErrorStreak, setTileErrorStreak] = useState(0)
  const hasFailed = tileErrorStreak >= TILE_ERROR_FALLBACK_THRESHOLD

  // The card is sized by a responsive grid (1/2/3 columns), so its width is a runtime
  // fact, not a constant. It feeds both the tile range and `zoomForRadius`'s framing
  // target, so measuring it is what keeps the fence at its intended fraction of the
  // card at every breakpoint instead of only at one assumed width.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [widthPx, setWidthPx] = useState(DEFAULT_THUMBNAIL_WIDTH_PX)

  useEffect(() => {
    const element = containerRef.current
    // Guarded rather than assumed: jsdom (and older Safari) has no ResizeObserver, and
    // the component must still render a correct map at the default width without it.
    if (element === null || typeof ResizeObserver === 'undefined') {
      return
    }
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0
      if (measured > 0) {
        setWidthPx(measured)
      }
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // Framed on the SMALLER dimension. The band's height is fixed while its width
  // follows the card, so framing on width alone picks a zoom whose circle is taller
  // than the box — at the default 280px width and default 200m radius the fence was
  // drawn with a 93px radius into 75px of vertical room, clipped top and bottom on
  // every card. tiles.test.ts pins the invariant across every realistic width/radius.
  const zoom = zoomForRadius(radiusMetres, latitude, Math.min(widthPx, THUMBNAIL_HEIGHT_PX))
  const tiles = tileGrid(latitude, longitude, zoom, widthPx, THUMBNAIL_HEIGHT_PX)

  const metresPerPx = metresPerPixel(latitude, zoom)
  const fenceRadiusPx = radiusMetres / metresPerPx
  const scaleMetres = niceScaleMetres(metresPerPx * (widthPx * SCALE_BAR_TARGET_FRACTION))
  const scaleWidthPx = scaleMetres / metresPerPx

  const centreX = widthPx / 2
  const centreY = THUMBNAIL_HEIGHT_PX / 2

  return (
    <div
      ref={containerRef}
      // role/aria-label on the container, not on each tile: the tiles are fragments of
      // one image, so labelling all of them makes a screen reader announce the same
      // precinct once per tile. One label here, empty alts below.
      //
      // Dropped entirely in the failed state: there is no street map on screen then,
      // and GeofenceSchematic already labels itself as the diagram it is. Keeping this
      // label would both describe the wrong thing and nest one img role inside another.
      role={hasFailed ? undefined : 'img'}
      aria-label={hasFailed ? undefined : `Street map showing ${name}`}
      className={`relative w-full overflow-hidden bg-surf-low ${className ?? ''}`}
      style={{ height: THUMBNAIL_HEIGHT_PX }}
    >
      {hasFailed ? (
        <GeofenceSchematic radiusMetres={radiusMetres} className="w-full h-full" />
      ) : (
        <>
          {tiles.map((tile) => (
            // These are already-optimally-sized 256px CDN-cached tiles from an external
            // host (tile.openstreetmap.org) — routing them through next/image's
            // optimizer would add a server hop for zero benefit, so a plain <img> is
            // correct here, not an oversight.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${tile.x}-${tile.y}`}
              src={tileUrl(tile.x, tile.y, zoom)}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setTileErrorStreak((streak) => streak + 1)}
              onLoad={() => setTileErrorStreak(0)}
              className="absolute max-w-none"
              style={{ left: tile.left, top: tile.top, width: TILE_SIZE_PX, height: TILE_SIZE_PX }}
            />
          ))}

          <svg
            viewBox={`0 0 ${widthPx} ${THUMBNAIL_HEIGHT_PX}`}
            className="absolute inset-0 w-full h-full pointer-events-none"
            aria-hidden="true"
          >
            {/* Fence, matching GeofenceSchematic's fill/stroke convention so both surfaces agree visually. */}
            <circle
              data-testid="thumbnail-fence-circle"
              cx={centreX}
              cy={centreY}
              r={fenceRadiusPx}
              className="fill-sec stroke-sec"
              fillOpacity={0.1}
              strokeWidth={1.5}
            />

            {/* Centre pin marking the precinct itself. */}
            <circle cx={centreX} cy={centreY} r={4} className="fill-sec" />

            {/* Scale bar pill, translucent so it stays legible over arbitrary imagery underneath. */}
            <g
              transform={`translate(${SCALE_BAR_MARGIN_PX}, ${THUMBNAIL_HEIGHT_PX - SCALE_BAR_MARGIN_PX - 8})`}
            >
              <rect
                x={-6}
                y={-14}
                width={scaleWidthPx + 12}
                height={24}
                rx={4}
                className="fill-surf-lowest"
                fillOpacity={0.85}
              />
              <line
                x1={0}
                y1={0}
                x2={scaleWidthPx}
                y2={0}
                className="stroke-on-surf-v"
                strokeWidth={1.5}
              />
              <line x1={0} y1={-3} x2={0} y2={3} className="stroke-on-surf-v" strokeWidth={1.5} />
              <line
                x1={scaleWidthPx}
                y1={-3}
                x2={scaleWidthPx}
                y2={3}
                className="stroke-on-surf-v"
                strokeWidth={1.5}
              />
              <text
                x={scaleWidthPx / 2}
                y={-6}
                textAnchor="middle"
                className="fill-on-surf-v"
                fontSize={9}
                fontWeight={700}
                letterSpacing="0.06em"
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {scaleMetres} m
              </text>
            </g>
          </svg>
        </>
      )}
    </div>
  )
}
