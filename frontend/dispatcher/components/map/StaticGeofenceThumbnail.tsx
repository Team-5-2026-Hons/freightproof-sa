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

// Assumed width until the element is actually measured (server render, first paint, or
// no ResizeObserver). Sized to a typical precinct card so the thumbnail doesn't visibly re-frame on mount.
export const DEFAULT_THUMBNAIL_WIDTH_PX = 280

// Fixed so the map band never grows/shrinks as tiles load progressively, shifting cards
// below it. Only the width is fluid, following the card's responsive grid sizing.
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
 * look like one continuous map, with the geofence drawn to scale as an SVG overlay.
 * Plain `<img>` tiles, not `next/image` or Leaflet — these are already-optimal
 * CDN-cached tiles, and Leaflet stays exclusive to `GeofenceMap.tsx`. Falls back to
 * `GeofenceSchematic` the instant any tile fails to load.
 */
export function StaticGeofenceThumbnail({
  latitude,
  longitude,
  radiusMetres,
  name,
  className,
}: StaticGeofenceThumbnailProps) {
  // A single flag, not per-tile tracking: one broken tile already breaks the illusion
  // of a continuous map. Counted, not latched — only a RUN of failures with nothing
  // loading between them means the server is unreachable; reset by any success. Same
  // policy and constant as GeofenceMap.
  const [tileErrorStreak, setTileErrorStreak] = useState(0)
  const hasFailed = tileErrorStreak >= TILE_ERROR_FALLBACK_THRESHOLD

  // The card's width is a runtime fact (responsive grid), so it's measured to keep the
  // fence at its intended fraction of the card at every breakpoint.
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [widthPx, setWidthPx] = useState(DEFAULT_THUMBNAIL_WIDTH_PX)

  useEffect(() => {
    const element = containerRef.current
    // jsdom and older Safari have no ResizeObserver; must still render at the default width.
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

  // Framed on the smaller dimension so the fence circle can't clip the fixed-height
  // band. tiles.test.ts pins this invariant across realistic width/radius combos.
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
      // On the container, not each tile — the tiles are fragments of one image. Dropped
      // in the failed state since GeofenceSchematic labels itself.
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
            // Plain <img>, not next/image: already-optimal CDN-cached tiles, see file doc.
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
