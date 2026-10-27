'use client'

import { useEffect, useRef, useState } from 'react'
import type { Circle, LayerGroup, Map as LeafletMap, Polyline, TileLayer } from 'leaflet'

import 'leaflet/dist/leaflet.css'

import { TILE_SOURCES, type TileSourceKey } from '@/lib/map/tiles'
import { haversineMetres, type Coords } from '@/lib/phase/geo'
import {
  BOUNDARY_NEARBY_METRES,
  FIX_LABELS,
  boundaryInDefaultFrame,
  boundaryIsNearby,
  validBoundary,
  validFixCoords,
  type FixSource,
  type LocationEvidence,
} from '@/lib/phase/location-evidence'

import { attachTileFailureTracking } from './GeofenceMap'
import { LocationComparisonSchematic } from './LocationComparisonSchematic'

const DEFAULT_SINGLE_FIX_ZOOM = 16

const FIT_BOUNDS_PADDING_TOP_LEFT_PX: [number, number] = [24, 64]
const FIT_BOUNDS_PADDING_BOTTOM_RIGHT_PX: [number, number] = [24, 40]

const METRES_PER_DEGREE_LATITUDE = 111_320

const MIN_COS_LATITUDE = Number.EPSILON

const DEGENERATE_BOUNDS_PAD_DEG = 0.0003

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** A fit-to-bounds box in plain lat/lng, deliberately not a Leaflet LatLngBounds: this
 *  stays importable and testable without Leaflet. */
export interface BoundsExtent {
  south: number
  west: number
  north: number
  east: number
}

/** Nothing to fit an extent to (a single point): centre on it directly rather than
 *  fitBounds on a zero-area box. */
export interface CenterExtent {
  center: Coords
}

export type ComparisonExtent = BoundsExtent | CenterExtent | null

export type FrameTarget = 'fixes' | 'precinct'

export const COMPARISON_MAP_INTERACTION = { scrollWheelZoom: true } as const

export { BOUNDARY_NEARBY_METRES, boundaryDistanceMetres, boundaryIsNearby } from '@/lib/phase/location-evidence'

/** Pads a zero-area box (coincident fixes, or an exactly-zero-radius boundary) so
 *  Leaflet's fitBounds receives a real box instead of a single point: fitBounds on a
 *  zero-area box zooms in to Leaflet's max zoom rather than anything sensible. */
function padIfDegenerate(box: BoundsExtent): BoundsExtent {
  if (box.south === box.north && box.west === box.east) {
    return {
      south: box.south - DEGENERATE_BOUNDS_PAD_DEG,
      west: box.west - DEGENERATE_BOUNDS_PAD_DEG,
      north: box.north + DEGENERATE_BOUNDS_PAD_DEG,
      east: box.east + DEGENERATE_BOUNDS_PAD_DEG,
    }
  }
  return box
}

/** The boundary circle's own bounding box, in plain lat/lng degrees (see
 *  METRES_PER_DEGREE_LATITUDE and MIN_COS_LATITUDE above for the approximation used). */
function boundaryBox(boundary: NonNullable<LocationEvidence['boundary']>): BoundsExtent {
  const latSpanDeg = boundary.radiusMetres / METRES_PER_DEGREE_LATITUDE
  const cosLat = Math.max(Math.abs(Math.cos(toRadians(boundary.coords.lat))), MIN_COS_LATITUDE)
  const lngSpanDeg = boundary.radiusMetres / (METRES_PER_DEGREE_LATITUDE * cosLat)
  return padIfDegenerate({
    south: boundary.coords.lat - latSpanDeg,
    west: boundary.coords.lng - lngSpanDeg,
    north: boundary.coords.lat + latSpanDeg,
    east: boundary.coords.lng + lngSpanDeg,
  })
}

/**
 * The map extent for the given frame target, or `null` when there is nothing to draw at
 * all for that target.
 *
 * `'fixes'` (the default, and the view a freshly opened modal shows first): the extent of
 * the valid fixes only, plus the boundary circle when, and only when,
 * boundaryIsNearby(evidence) is true. A boundary far from every fix is left out so the
 * fixes stay readable instead of the frame zooming out to fit a boundary a whole country
 * away. With no fixes at all there is nothing "fixes-first" to prefer, so this falls
 * back to the boundary circle, unchanged from this function's pre-R4 behaviour for that
 * branch.
 *
 * `'precinct'`: the boundary circle's own extent only, regardless of the fixes; null
 * when there is no boundary. Reached via the Fixes/Precinct control this component
 * renders whenever the default 'fixes' frame would otherwise hide a far boundary.
 *
 * Exported as a pure function (no Leaflet import) so this (the only branching logic in
 * the map worth getting wrong) is unit-testable without mounting Leaflet in jsdom. See
 * __tests__/LocationComparisonMap.test.tsx.
 */
export function comparisonBounds(evidence: LocationEvidence, target: FrameTarget = 'fixes'): ComparisonExtent {
  const boundary = validBoundary(evidence)

  if (target === 'precinct') {
    return boundary === null ? null : boundaryBox(boundary)
  }

  const points = validFixCoords(evidence)

  if (points.length === 0) {
    return boundary === null ? null : boundaryBox(boundary)
  }

  const includeBoundary = boundaryInDefaultFrame(evidence) !== null

  if (points.length === 1 && !includeBoundary) {
    return { center: points[0] }
  }

  let south = Infinity, west = Infinity, north = -Infinity, east = -Infinity
  function extend(lat: number, lng: number): void {
    south = Math.min(south, lat)
    north = Math.max(north, lat)
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  }

  for (const point of points) {
    extend(point.lat, point.lng)
  }

  if (includeBoundary && boundary !== null) {
    const latSpanDeg = boundary.radiusMetres / METRES_PER_DEGREE_LATITUDE
    const cosLat = Math.max(Math.abs(Math.cos(toRadians(boundary.coords.lat))), MIN_COS_LATITUDE)
    const lngSpanDeg = boundary.radiusMetres / (METRES_PER_DEGREE_LATITUDE * cosLat)
    extend(boundary.coords.lat - latSpanDeg, boundary.coords.lng - lngSpanDeg)
    extend(boundary.coords.lat + latSpanDeg, boundary.coords.lng + lngSpanDeg)
  }

  if (!Number.isFinite(south) || !Number.isFinite(west) || !Number.isFinite(north) || !Number.isFinite(east)) {
    return null
  }

  return padIfDegenerate({ south, west, north, east })
}

/** The centre a freshly-created map should open on, before its first real fit: derived
 *  from the same extent comparisonBounds computes, so there is no separate notion of
 *  "starting position" that could disagree with where the map immediately fits to. */
function initialCenter(evidence: LocationEvidence): Coords {
  const extent = comparisonBounds(evidence)
  if (extent === null) {
    return { lat: 0, lng: 0 }
  }
  if ('center' in extent) {
    return extent.center
  }
  return { lat: (extent.south + extent.north) / 2, lng: (extent.west + extent.east) / 2 }
}

const MARKER_SIZE_PX = 16
const MARKER_LABEL_GAP_PX = 4

const MARKER_SHAPE_CLASS: Record<FixSource, string> = {
  driver_phone: 'rounded-full bg-sec',
  horse_tracker: 'rounded-none bg-chain',
}

/**
 * The `divIcon` markup for a recorded fix: a coloured, shaped body plus an
 * always-visible text label, per the brief's read-only-map requirement that fixes be
 * told apart by shape and text, not colour alone.
 *
 * Exported (not inlined into the marker-building effect) so the shape/label contract is
 * unit-testable without mounting Leaflet: see __tests__/LocationComparisonMap.test.tsx.
 */
export function markerIconHtml(source: FixSource): string {
  const shapeClass = MARKER_SHAPE_CLASS[source]
  const label = FIX_LABELS[source]
  return (
    `<div class="flex flex-col items-center" style="gap:${MARKER_LABEL_GAP_PX}px">` +
    `<div data-testid="marker-shape-${source}" style="width:${MARKER_SIZE_PX}px;height:${MARKER_SIZE_PX}px" ` +
    `class="${shapeClass} border-2 border-surf-lowest shadow-level-1"></div>` +
    `<span class="text-[10px] font-[700] leading-none text-on-surf bg-surf-lowest/90 px-1 rounded whitespace-nowrap">` +
    `${label}</span>` +
    `</div>`
  )
}

const MARKER_ICON_ANCHOR: [number, number] = [MARKER_SIZE_PX / 2, MARKER_SIZE_PX / 2]
const MARKER_ICON_SIZE: [number, number] = [MARKER_SIZE_PX, MARKER_SIZE_PX]

const SEPARATION_LINE_CASING_CLASS = 'stroke-surf-lowest'
const SEPARATION_LINE_CASING_WEIGHT = 5
const SEPARATION_LINE_CASING_OPACITY = 0.85
const SEPARATION_LINE_CLASS = 'stroke-sec'
const SEPARATION_LINE_WEIGHT = 2.5
const SEPARATION_LINE_DASH = '8 6'

const BOUNDARY_CIRCLE_CLASS = 'fill-sec stroke-sec'
const BOUNDARY_CIRCLE_WEIGHT = 2
const BOUNDARY_CIRCLE_FILL_OPACITY = 0.08
const BOUNDARY_CIRCLE_DASH = '6 6'

const CONTROL_BUTTON_SELECTED_CLASS =
  'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase bg-surf-low text-on-surf'
const CONTROL_BUTTON_UNSELECTED_CLASS =
  'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase text-on-surf-v hover:text-on-surf'

const FRAME_TOGGLE_TOP_PX = 48

const FRAME_FIXES_LABEL = 'Fixes'
const FRAME_PRECINCT_LABEL = 'Precinct'

interface Props {
  evidence: LocationEvidence
  className?: string
}

/**
 * Read-only Leaflet comparison of the driver phone fix against the horse tracker fix for
 * one phase, on the same basemap stack as the precinct map (GeofenceMap.tsx): real
 * tiles by default, `LocationComparisonSchematic` as the tile-failure fallback.
 *
 * Genuinely read-only: no draggable markers, no click handlers, nothing that could
 * mutate `evidence` or emit a position. This component only ever turns evidence INTO
 * pixels; task R2 wires it into a modal, and no future change here should add a way for
 * this map to write anything back.
 *
 * The whole layer set (markers, separation line, boundary circle) is rebuilt from
 * scratch on every `evidence` change via a single Leaflet LayerGroup that is cleared and
 * refilled, rather than diffed layer-by-layer: this map is opened once per phase and
 * never live-updated while open, so there is no meaningful "diff" to preserve, and a
 * full rebuild is far simpler than keeping five separate layer refs in sync.
 */
export function LocationComparisonMap({ evidence, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const tileRef = useRef<TileLayer | null>(null)
  const layerGroupRef = useRef<LayerGroup | null>(null)
  const tileFailureCleanupRef = useRef<(() => void) | null>(null)

  const [source, setSource] = useState<TileSourceKey>('satellite')
  const [failed, setFailed] = useState(false)
  const [initAttempt, setInitAttempt] = useState(0)
  const [mapReady, setMapReady] = useState(false)
  const [frame, setFrame] = useState<FrameTarget>('fixes')

  useEffect(() => {
    let cancelled = false

    async function init(): Promise<void> {
      try {
        const L = await import('leaflet')
        if (cancelled || containerRef.current === null || mapRef.current !== null) return

        const centre = initialCenter(evidence)
        const map = L.map(containerRef.current, {
          center: [centre.lat, centre.lng],
          zoom: DEFAULT_SINGLE_FIX_ZOOM,
          ...COMPARISON_MAP_INTERACTION,
        })

        const chosen = TILE_SOURCES.satellite
        tileRef.current = L.tileLayer(chosen.url, {
          attribution: chosen.attribution,
          maxZoom: chosen.maxZoom,
        }).addTo(map)
        tileFailureCleanupRef.current = attachTileFailureTracking(
          tileRef.current,
          () => { if (!cancelled) setFailed(true) },
          () => { if (!cancelled) setFailed(false) },
        )

        layerGroupRef.current = L.layerGroup().addTo(map)

        mapRef.current = map
        setMapReady(true)
      } catch {
        if (!cancelled) setFailed(true)
      }
    }

    void init()

    return () => {
      cancelled = true
      setMapReady(false)
      tileFailureCleanupRef.current?.()
      tileFailureCleanupRef.current = null
      layerGroupRef.current?.clearLayers()
      layerGroupRef.current = null
      mapRef.current?.remove()
      mapRef.current = null
      tileRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initAttempt])

  useEffect(() => {
    let cancelled = false

    async function rebuildLayers(): Promise<void> {
      const map = mapRef.current
      const layerGroup = layerGroupRef.current
      if (map === null || layerGroup === null) return

      const L = await import('leaflet')
      if (cancelled || mapRef.current === null) return

      layerGroup.clearLayers()

      const driver = evidence.driverFix
      const tracker = evidence.trackerFix

      if (driver) {
        L.marker([driver.coords.lat, driver.coords.lng], {
          icon: L.divIcon({
            className: '',
            html: markerIconHtml('driver_phone'),
            iconSize: MARKER_ICON_SIZE,
            iconAnchor: MARKER_ICON_ANCHOR,
          }),
          interactive: false,
        }).addTo(layerGroup)
      }

      if (tracker) {
        L.marker([tracker.coords.lat, tracker.coords.lng], {
          icon: L.divIcon({
            className: '',
            html: markerIconHtml('horse_tracker'),
            iconSize: MARKER_ICON_SIZE,
            iconAnchor: MARKER_ICON_ANCHOR,
          }),
          interactive: false,
        }).addTo(layerGroup)
      }

      if (driver && tracker) {
        const points: [[number, number], [number, number]] = [
          [driver.coords.lat, driver.coords.lng],
          [tracker.coords.lat, tracker.coords.lng],
        ]
        const casing: Polyline = L.polyline(points, {
          className: SEPARATION_LINE_CASING_CLASS,
          weight: SEPARATION_LINE_CASING_WEIGHT,
          opacity: SEPARATION_LINE_CASING_OPACITY,
          interactive: false,
        })
        casing.addTo(layerGroup)

        const line: Polyline = L.polyline(points, {
          className: SEPARATION_LINE_CLASS,
          dashArray: SEPARATION_LINE_DASH,
          weight: SEPARATION_LINE_WEIGHT,
          interactive: false,
        })
        line.addTo(layerGroup)
      }

      const boundary = validBoundary(evidence)
      if (boundary !== null && boundary.polygon) {
        L.polygon(boundary.polygon.map(([lat, lng]) => [lat, lng] as [number, number]), {
          className: BOUNDARY_CIRCLE_CLASS,
          weight: BOUNDARY_CIRCLE_WEIGHT,
          fillOpacity: BOUNDARY_CIRCLE_FILL_OPACITY,
          dashArray: BOUNDARY_CIRCLE_DASH,
          interactive: false,
        }).addTo(layerGroup)
      } else if (boundary !== null) {
        const circle: Circle = L.circle([boundary.coords.lat, boundary.coords.lng], {
          radius: boundary.radiusMetres,
          className: BOUNDARY_CIRCLE_CLASS,
          weight: BOUNDARY_CIRCLE_WEIGHT,
          fillOpacity: BOUNDARY_CIRCLE_FILL_OPACITY,
          dashArray: BOUNDARY_CIRCLE_DASH,
          interactive: false,
        })
        circle.addTo(layerGroup)
      }
    }

    void rebuildLayers()

    return () => {
      cancelled = true
    }
  }, [evidence, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (map === null) return

    const extent = comparisonBounds(evidence, frame)
    if (extent === null) return

    if ('center' in extent) {
      map.setView([extent.center.lat, extent.center.lng], DEFAULT_SINGLE_FIX_ZOOM)
    } else {
      map.fitBounds(
        [
          [extent.south, extent.west],
          [extent.north, extent.east],
        ],
        {
          paddingTopLeft: FIT_BOUNDS_PADDING_TOP_LEFT_PX,
          paddingBottomRight: FIT_BOUNDS_PADDING_BOTTOM_RIGHT_PX,
        },
      )
    }
  }, [evidence, frame, mapReady])

  useEffect(() => {
    let cancelled = false

    async function swapTiles(): Promise<void> {
      if (mapRef.current === null) return
      const L = await import('leaflet')
      const map = mapRef.current
      if (cancelled || map === null) return

      const chosen = TILE_SOURCES[source]
      tileFailureCleanupRef.current?.()
      tileRef.current?.remove()
      tileRef.current = L.tileLayer(chosen.url, {
        attribution: chosen.attribution,
        maxZoom: chosen.maxZoom,
      }).addTo(map)
      tileFailureCleanupRef.current = attachTileFailureTracking(tileRef.current, () => {
        if (!cancelled) setFailed(true)
      }, () => {
        if (!cancelled) setFailed(false)
      })
    }

    void swapTiles()

    return () => {
      cancelled = true
    }
  }, [source, mapReady])

  return (
    <div className={`relative ${className ?? ''}`}>
      <div ref={containerRef} className="w-full h-full rounded-lg overflow-hidden" />

      {failed && (
        <div
          className="absolute inset-0 z-[500] flex flex-col items-center justify-center gap-2 bg-surf-low rounded-lg p-4"
          role="status"
        >
          <LocationComparisonSchematic evidence={evidence} />
          <p className="text-[11px] text-on-surf-v text-center">
            Map unavailable: showing recorded fixes to scale.
          </p>
          <button
            type="button"
            onClick={() => {
              setFailed(false)
              setInitAttempt((attempt) => attempt + 1)
            }}
            className="px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase text-on-surf-v hover:text-on-surf"
          >
            Retry map
          </button>
        </div>
      )}

      <div className="absolute top-3 right-3 z-[400] flex items-center gap-[2px] bg-surf-lowest rounded-md p-[3px] shadow-level-1">
        {(Object.keys(TILE_SOURCES) as TileSourceKey[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setSource(key)}
            className={source === key ? CONTROL_BUTTON_SELECTED_CLASS : CONTROL_BUTTON_UNSELECTED_CLASS}
          >
            {TILE_SOURCES[key].label}
          </button>
        ))}
      </div>

      {evidence.boundary && !boundaryIsNearby(evidence) && (
        <div
          className="absolute right-3 z-[400] flex items-center gap-[2px] bg-surf-lowest rounded-md p-[3px] shadow-level-1"
          style={{ top: FRAME_TOGGLE_TOP_PX }}
        >
          <button
            type="button"
            onClick={() => setFrame('fixes')}
            className={frame === 'fixes' ? CONTROL_BUTTON_SELECTED_CLASS : CONTROL_BUTTON_UNSELECTED_CLASS}
          >
            {FRAME_FIXES_LABEL}
          </button>
          <button
            type="button"
            onClick={() => setFrame('precinct')}
            className={frame === 'precinct' ? CONTROL_BUTTON_SELECTED_CLASS : CONTROL_BUTTON_UNSELECTED_CLASS}
          >
            {FRAME_PRECINCT_LABEL}
          </button>
        </div>
      )}
    </div>
  )
}
