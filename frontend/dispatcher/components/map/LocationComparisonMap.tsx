'use client'

import { useEffect, useRef, useState } from 'react'
import type { Circle, LayerGroup, Map as LeafletMap, Polyline, TileLayer } from 'leaflet'

// Same reasoning as GeofenceMap.tsx: static import, not dynamic.
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

// Matches GeofenceMap's own DEFAULT_ZOOM so both surfaces frame a lone point the same way.
const DEFAULT_SINGLE_FIX_ZOOM = 16

// Asymmetric because the map's chrome isn't symmetric: the Satellite/Street toggle sits
// top-right, Leaflet's attribution strip sits bottom-right — without this a fitted
// marker can land directly under either.
const FIT_BOUNDS_PADDING_TOP_LEFT_PX: [number, number] = [24, 64]
const FIT_BOUNDS_PADDING_BOTTOM_RIGHT_PX: [number, number] = [24, 40]

// Equirectangular approximation for expanding the boundary circle into a lat/lng box —
// good enough for sizing a fit-bounds box, not geodesically exact.
const METRES_PER_DEGREE_LATITUDE = 111_320

// Guards the longitude-per-metre conversion at the poles, where cos(lat) rounds to 0.
const MIN_COS_LATITUDE = Number.EPSILON

// Pads a degenerate box (coincident fixes, zero-radius boundary) so fitBounds gets a real
// box instead of a point (which would zoom to Leaflet's max). ~35m at the equator.
const DEGENERATE_BOUNDS_PAD_DEG = 0.0003

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** A fit-to-bounds box in plain lat/lng, deliberately not a Leaflet LatLngBounds, so it stays testable without Leaflet. */
export interface BoundsExtent {
  south: number
  west: number
  north: number
  east: number
}

/** A single point to centre on, rather than fitBounds on a zero-area box. */
export interface CenterExtent {
  center: Coords
}

export type ComparisonExtent = BoundsExtent | CenterExtent | null

export type FrameTarget = 'fixes' | 'precinct'

// Framing helpers live in lib/phase/location-evidence.ts so the schematic fallback can
// share them without a circular import; re-exported so this stays their documented home.
export { BOUNDARY_NEARBY_METRES, boundaryDistanceMetres, boundaryIsNearby } from '@/lib/phase/location-evidence'

/** Pads a zero-area box so fitBounds gets a real box instead of a point. */
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

/** The boundary circle's bounding box in plain lat/lng degrees. */
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
 * The map extent for the given frame target, or `null` when there is nothing to draw.
 * `'fixes'` (default): the valid fixes' extent, plus the boundary only when nearby
 * (boundaryIsNearby), so a far boundary doesn't zoom the frame out. Falls back to the
 * boundary alone when there are no fixes. `'precinct'`: the boundary's own extent only.
 * Exported as a pure function so it's unit-testable without mounting Leaflet — see
 * __tests__/LocationComparisonMap.test.tsx.
 */
export function comparisonBounds(evidence: LocationEvidence, target: FrameTarget = 'fixes'): ComparisonExtent {
  const boundary = validBoundary(evidence)

  if (target === 'precinct') {
    return boundary === null ? null : boundaryBox(boundary)
  }

  const points = validFixCoords(evidence)

  if (points.length === 0) {
    // No fixes to frame on: fall back to the boundary circle if there is one.
    return boundary === null ? null : boundaryBox(boundary)
  }

  const includeBoundary = boundaryInDefaultFrame(evidence) !== null

  // A single fix with no boundary is a point, not an extent — centre on it directly
  // rather than fitBounds over-zooming a zero-area box.
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

/** The centre a freshly-created map opens on before its first real fit, derived from the
 *  same extent comparisonBounds computes. */
function initialCenter(evidence: LocationEvidence): Coords {
  const extent = comparisonBounds(evidence)
  if (extent === null) {
    // No fix and no boundary: unreachable in practice (see hasAnyFix in
    // lib/phase/location-evidence.ts), but a harmless placeholder either way.
    return { lat: 0, lng: 0 }
  }
  if ('center' in extent) {
    return extent.center
  }
  return { lat: (extent.south + extent.north) / 2, lng: (extent.west + extent.east) / 2 }
}

// Matches GeofenceMap's PIN_DIAMETER_PX so markers read at the same visual weight on both surfaces.
const MARKER_SIZE_PX = 16
const MARKER_LABEL_GAP_PX = 4

// Shape (circle vs square) is the primary distinguisher so the two fixes read apart
// without relying on colour alone; `sec`/`chain` match LocationComparisonSchematic's pairing.
const MARKER_SHAPE_CLASS: Record<FixSource, string> = {
  driver_phone: 'rounded-full bg-sec',
  horse_tracker: 'rounded-none bg-chain',
}

/**
 * The `divIcon` markup for a recorded fix: a coloured, shaped body plus an
 * always-visible text label, so fixes are told apart by shape and text, not colour
 * alone. Exported so this is unit-testable without mounting Leaflet — see
 * __tests__/LocationComparisonMap.test.tsx.
 */
export function markerIconHtml(source: FixSource): string {
  const shapeClass = MARKER_SHAPE_CLASS[source]
  const label = FIX_LABELS[source]
  return (
    // Inline style, not a Tailwind arbitrary-value class: Tailwind's content scan can't
    // see a JS constant interpolated inside the brackets (see FRAME_TOGGLE_TOP_PX).
    `<div class="flex flex-col items-center" style="gap:${MARKER_LABEL_GAP_PX}px">` +
    `<div data-testid="marker-shape-${source}" style="width:${MARKER_SIZE_PX}px;height:${MARKER_SIZE_PX}px" ` +
    `class="${shapeClass} border-2 border-surf-lowest shadow-level-1"></div>` +
    `<span class="text-[10px] font-[700] leading-none text-on-surf bg-surf-lowest/90 px-1 rounded whitespace-nowrap">` +
    `${label}</span>` +
    `</div>`
  )
}

// Half the icon's box: centres the SHAPE (not the label text below it) on the coordinate.
const MARKER_ICON_ANCHOR: [number, number] = [MARKER_SIZE_PX / 2, MARKER_SIZE_PX / 2]
const MARKER_ICON_SIZE: [number, number] = [MARKER_SIZE_PX, MARKER_SIZE_PX]

// className, not Leaflet's color/fillColor options, which only accept literal CSS colour
// strings — same pattern as GeofenceMap's GEOFENCE_CIRCLE_CLASS.
// Drawn as a solid white casing plus a dashed `sec` accent on top, since a plain
// `stroke-on-surf-v` dash reads as invisible against Esri satellite tiles.
const SEPARATION_LINE_CASING_CLASS = 'stroke-surf-lowest'
const SEPARATION_LINE_CASING_WEIGHT = 5
const SEPARATION_LINE_CASING_OPACITY = 0.85
const SEPARATION_LINE_CLASS = 'stroke-sec'
const SEPARATION_LINE_WEIGHT = 2.5
const SEPARATION_LINE_DASH = '8 6'

// Matches GeofenceMap's precinct fence styling for a consistent "this is a geofence"
// language across both surfaces; fillOpacity kept lower than GeofenceMap's 0.1 since
// this map also has two markers and a separation line inside the same circle.
const BOUNDARY_CIRCLE_CLASS = 'fill-sec stroke-sec'
const BOUNDARY_CIRCLE_WEIGHT = 2
const BOUNDARY_CIRCLE_FILL_OPACITY = 0.08
const BOUNDARY_CIRCLE_DASH = '6 6'

// Shared by the Satellite/Street and Fixes/Precinct toggles so their selected styling can't drift apart.
const CONTROL_BUTTON_SELECTED_CLASS =
  'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase bg-surf-low text-on-surf'
const CONTROL_BUTTON_UNSELECTED_CLASS =
  'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase text-on-surf-v hover:text-on-surf'

// Inline style, not a `top-[...]` class (Tailwind's content scan can't see an
// interpolated JS constant). Clears the Satellite/Street toggle above it (~40px) plus a small gap.
const FRAME_TOGGLE_TOP_PX = 48

const FRAME_FIXES_LABEL = 'Fixes'
const FRAME_PRECINCT_LABEL = 'Precinct'

interface Props {
  evidence: LocationEvidence
  className?: string
}

/**
 * Read-only Leaflet comparison of the driver phone fix against the horse tracker fix for
 * one phase, on the same basemap stack as GeofenceMap.tsx: real tiles by default,
 * `LocationComparisonSchematic` as the tile-failure fallback. No draggable markers or
 * click handlers — nothing here can mutate `evidence` or emit a position. The whole
 * layer set is rebuilt from scratch on every `evidence` change via a single cleared and
 * refilled LayerGroup, since this map is opened once per phase and never live-updated.
 */
export function LocationComparisonMap({ evidence, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<LeafletMap | null>(null)
  const tileRef = useRef<TileLayer | null>(null)
  const layerGroupRef = useRef<LayerGroup | null>(null)
  const tileFailureCleanupRef = useRef<(() => void) | null>(null)

  const [source, setSource] = useState<TileSourceKey>('satellite')
  const [failed, setFailed] = useState(false)
  // Bumped by "Retry map" to re-run init — same two-cause reasoning as GeofenceMap.
  const [initAttempt, setInitAttempt] = useState(0)
  // Dependency for effects below, same reason as GeofenceMap's `mapReady`: a rebuild
  // requested before Leaflet finishes loading must still run once it has.
  const [mapReady, setMapReady] = useState(false)
  // Which extent the map is fitted to, picked via the Fixes/Precinct control.
  const [frame, setFrame] = useState<FrameTarget>('fixes')

  // Init once; `evidence` changes are applied by the layer-rebuild effect below.
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
          // Sits inside a scrollable modal — disabled so scrolling past it doesn't zoom it.
          scrollWheelZoom: false,
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
        // Chunk or tiles unreachable — fall back to the schematic.
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
    // Only initAttempt: builds the map once; the rebuild effect below keeps layers and view in sync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initAttempt])

  // Rebuild every drawn layer from `evidence`, on mapReady and on every evidence change
  // after. The view fit is a separate effect below (keyed on `frame` too) so toggling
  // Fixes/Precinct re-fits without redrawing every layer.
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

      // `interactive: false` on every layer reinforces the read-only contract: no hover/focus affordances.
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

      // A straight separation line, never a route — drawn only when both fixes exist.
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

      // Only the CURRENT precinct boundary, read through validBoundary (same guard the
      // framing and distance row use). No bindTooltip label here — it would sit on top
      // of the driver marker's label near the precinct centre; the label is rendered as
      // a legend line by the hosting modal instead (LocationEvidencePanel.tsx).
      const boundary = validBoundary(evidence)
      if (boundary !== null) {
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

  // Fits the view to the active frame (Fixes vs Precinct), separate from redrawing layers.
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
    // mapReady dependency: applies a source chosen before Leaflet finished loading, same as GeofenceMap.
  }, [source, mapReady])

  // Overlay, not replacement — the map stays mounted underneath, same as GeofenceMap.
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

      {/* Only rendered when the default 'fixes' frame would otherwise hide the boundary. */}
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
