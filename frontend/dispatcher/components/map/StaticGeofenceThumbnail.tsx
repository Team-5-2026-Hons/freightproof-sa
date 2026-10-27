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

import { enclosingRadiusMetres } from '@/lib/map/polygon'
import type { LatLngPair } from '@shared/lib/types/precinct'

import { GeofenceSchematic, SCALE_BAR_TARGET_FRACTION, niceScaleMetres } from './GeofenceSchematic'

const METRES_PER_DEGREE = (Math.PI * 6_371_008.8) / 180

export const DEFAULT_THUMBNAIL_WIDTH_PX = 280

const THUMBNAIL_HEIGHT_PX = 150

const SCALE_BAR_MARGIN_PX = 10

interface StaticGeofenceThumbnailProps {
  latitude: number
  longitude: number
  radiusMetres: number
  polygon?: readonly LatLngPair[] | null
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
  polygon = null,
  name,
  className,
}: StaticGeofenceThumbnailProps) {
  const outline = polygon !== null && polygon.length >= 3 ? polygon : null
  const [tileErrorStreak, setTileErrorStreak] = useState(0)
  const hasFailed = tileErrorStreak >= TILE_ERROR_FALLBACK_THRESHOLD

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [widthPx, setWidthPx] = useState(DEFAULT_THUMBNAIL_WIDTH_PX)

  useEffect(() => {
    const element = containerRef.current
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

  const frameRadiusMetres = outline !== null ? enclosingRadiusMetres(outline, [latitude, longitude]) : radiusMetres
  const zoom = zoomForRadius(frameRadiusMetres, latitude, Math.min(widthPx, THUMBNAIL_HEIGHT_PX))
  const tiles = tileGrid(latitude, longitude, zoom, widthPx, THUMBNAIL_HEIGHT_PX)

  const metresPerPx = metresPerPixel(latitude, zoom)
  const fenceRadiusPx = radiusMetres / metresPerPx
  const scaleMetres = niceScaleMetres(metresPerPx * (widthPx * SCALE_BAR_TARGET_FRACTION))
  const scaleWidthPx = scaleMetres / metresPerPx

  const centreX = widthPx / 2
  const centreY = THUMBNAIL_HEIGHT_PX / 2

  const outlinePoints =
    outline === null
      ? null
      : outline
          .map(([lat, lng]) => {
            const eastMetres = (lng - longitude) * METRES_PER_DEGREE * Math.cos((latitude * Math.PI) / 180)
            const northMetres = (lat - latitude) * METRES_PER_DEGREE
            return `${(centreX + eastMetres / metresPerPx).toFixed(1)},${(centreY - northMetres / metresPerPx).toFixed(1)}`
          })
          .join(' ')

  return (
    <div
      ref={containerRef}
      role={hasFailed ? undefined : 'img'}
      aria-label={hasFailed ? undefined : `Street map showing ${name}`}
      className={`relative w-full overflow-hidden bg-surf-low ${className ?? ''}`}
      style={{ height: THUMBNAIL_HEIGHT_PX }}
    >
      {hasFailed ? (
        <GeofenceSchematic
          radiusMetres={radiusMetres}
          polygon={outline}
          centre={[latitude, longitude]}
          className="w-full h-full"
        />
      ) : (
        <>
          {tiles.map((tile) => (
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
            {outlinePoints !== null ? (
              <polygon
                data-testid="thumbnail-fence-outline"
                points={outlinePoints}
                className="fill-sec stroke-sec"
                fillOpacity={0.1}
                strokeWidth={1.5}
              />
            ) : (
              <circle
                data-testid="thumbnail-fence-circle"
                cx={centreX}
                cy={centreY}
                r={fenceRadiusPx}
                className="fill-sec stroke-sec"
                fillOpacity={0.1}
                strokeWidth={1.5}
              />
            )}

            <circle cx={centreX} cy={centreY} r={4} className="fill-sec" />

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
