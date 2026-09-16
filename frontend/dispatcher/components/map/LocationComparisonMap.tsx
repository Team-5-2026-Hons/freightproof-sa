'use client'

import { useEffect, useRef, useState } from 'react'
import type { Circle, LayerGroup, Map as LeafletMap, Polyline, TileLayer } from 'leaflet'

// Same reasoning as GeofenceMap.tsx: a static side-effect import type-checks cleanly
// under this project's bundler module resolution with no ambient `.d.ts`, unlike a
// dynamic `import('leaflet/dist/leaflet.css')`.
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

// Zoom used whenever there is exactly one point to show (a single fix, no boundary) and
// therefore no extent to fit; matches GeofenceMap's own DEFAULT_ZOOM so both surfaces
// frame a lone point the same way.
const DEFAULT_SINGLE_FIX_ZOOM = 16

// fitBounds padding is asymmetric, not a single px value, because the map's own chrome
// isn't symmetric. Leaflet's `paddingTopLeft`/`paddingBottomRight` options give
// [x, y] clearance measured in from the top-left and bottom-right corners respectively
// (not "padding for a top-left control"; there is no per-corner option). The
// Satellite/Street toggle sits top-right (see the absolute-positioned control in the
// returned JSX below), so it needs vertical clearance from paddingTopLeft's y and
// horizontal clearance from paddingBottomRight's x; Leaflet's own attribution strip
// sits bottom-right, needing paddingBottomRight's y. Without this a fitted marker can
// land directly under either.
const FIT_BOUNDS_PADDING_TOP_LEFT_PX: [number, number] = [24, 64]
const FIT_BOUNDS_PADDING_BOTTOM_RIGHT_PX: [number, number] = [24, 40]

// Metres-to-degrees conversion for expanding the boundary circle into a lat/lng box:
// the same equirectangular approximation LocationComparisonSchematic uses for its local
// projection (M_PER_DEG there). Good enough for sizing a fit-bounds box; not claimed to
// be geodesically exact.
const METRES_PER_DEGREE_LATITUDE = 111_320

// Guards the longitude-per-metre conversion at the poles, where cos(lat) rounds to 0 and
// would otherwise send the box to +/-Infinity. Never reachable by a real precinct, but
// comparisonBounds is a pure exported function and must not blow up on a hostile input.
const MIN_COS_LATITUDE = Number.EPSILON

// A degenerate box (two coincident fixes, or a zero-radius boundary) is padded by this
// many degrees so Leaflet's fitBounds receives a real box instead of a single point;
// fitBounds on a zero-area box zooms in to Leaflet's max zoom rather than anything
// "sensible". ~35m at the equator: enough margin to read as a small area, not a jump.
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

// Leaflet interaction options passed into `L.map(...)`. Unlike GeofenceMap (embedded
// directly on the page, where a stray scroll-wheel zoom while the dispatcher scrolls
// PAST the map is pure annoyance), this map only ever renders inside a Modal
// (components/domain/LocationEvidencePanel.tsx) that the dispatcher opened specifically
// to inspect it — scrolling the wheel over it is a deliberate zoom gesture, not an
// accident, so it should behave like any other map. Leaflet's own wheel handler calls
// `preventDefault()` on the underlying wheel event, so the dialog's own scroll never
// fires alongside it; no extra wheel-propagation handling has been added here on top of
// that, per the brief's own "only if a concrete need is demonstrated" instruction.
//
// Exported as a named constant (rather than inlined into the `L.map` call below) because
// it is the only part of this behaviour a jsdom test can observe: Leaflet is never
// mounted in this component's unit tests (see __tests__/LocationComparisonMap.test.tsx),
// so there is no live map instance whose real scroll-wheel behaviour a DOM test could
// assert on.
export const COMPARISON_MAP_INTERACTION = { scrollWheelZoom: true } as const

// The pure framing helpers (BOUNDARY_NEARBY_METRES, boundaryDistanceMetres,
// boundaryIsNearby) live in lib/phase/location-evidence.ts so the schematic fallback can
// share them without a circular import through this file. Re-exported here so this
// component stays the documented home for the map's framing contract.
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
    // No fixes at all to frame on: fall back to the boundary circle if there is one.
    // There is nothing "fixes-first" to prefer when there are no fixes.
    return boundary === null ? null : boundaryBox(boundary)
  }

  const includeBoundary = boundaryInDefaultFrame(evidence) !== null

  // A single fix with no boundary to draw alongside it is a point, not an extent:
  // fitBounds on a zero-area box would over-zoom, so centre on it at a fixed sensible
  // zoom instead (see DEFAULT_SINGLE_FIX_ZOOM at the call site).
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
    // No fix and no boundary: this component is only ever rendered when the phase has
    // at least one (see hasAnyFix in lib/phase/location-evidence.ts); (0, 0) is an
    // arbitrary but harmless placeholder that is corrected the moment real evidence
    // exists, since evidence is a required prop, not one that starts empty and fills in.
    return { lat: 0, lng: 0 }
  }
  if ('center' in extent) {
    return extent.center
  }
  return { lat: (extent.south + extent.north) / 2, lng: (extent.west + extent.east) / 2 }
}

// ── Marker rendering ────────────────────────────────────────────────────────────
// Diameter of the circular/square marker body. Matches GeofenceMap's PIN_DIAMETER_PX so
// every marker on either map surface reads at the same visual weight.
const MARKER_SIZE_PX = 16
const MARKER_LABEL_GAP_PX = 4

// Shape (circle vs square) is the primary distinguisher: required by the brief so the
// two fixes read apart without relying on colour alone. Colour is a secondary cue: `sec`
// for the driver phone (this codebase's default "the thing being placed" token, same as
// GeofenceMap's pin) and `chain` for the tracker, the same pairing
// LocationComparisonSchematic already uses, so the fallback and the live map agree on
// colour when one swaps for the other.
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
    // Inline style, not `gap-[${MARKER_LABEL_GAP_PX}px]`: Tailwind's content scan reads
    // literal source text, so an arbitrary-value class with a JS constant interpolated
    // inside the brackets is invisible to it and generates no CSS (see FRAME_TOGGLE_TOP_PX).
    `<div class="flex flex-col items-center" style="gap:${MARKER_LABEL_GAP_PX}px">` +
    `<div data-testid="marker-shape-${source}" style="width:${MARKER_SIZE_PX}px;height:${MARKER_SIZE_PX}px" ` +
    `class="${shapeClass} border-2 border-surf-lowest shadow-level-1"></div>` +
    `<span class="text-[10px] font-[700] leading-none text-on-surf bg-surf-lowest/90 px-1 rounded whitespace-nowrap">` +
    `${label}</span>` +
    `</div>`
  )
}

// Half the icon's rendered width/height is an approximation: the label text extends
// the actual box further, but the anchor only needs to centre the SHAPE on the
// coordinate, which is the part that has to sit exactly on the fix. A slightly-off
// anchor for the label text underneath is cosmetic, not evidentiary.
const MARKER_ICON_ANCHOR: [number, number] = [MARKER_SIZE_PX / 2, MARKER_SIZE_PX / 2]
const MARKER_ICON_SIZE: [number, number] = [MARKER_SIZE_PX, MARKER_SIZE_PX]

// Vector layer styling via `className`, not the `color`/`fillColor` options: Leaflet's
// options only accept literal CSS colour strings, which would mean hardcoding hex here
// (banned by this repo's eslint rule) instead of reading the Tailwind token map. Same
// pattern as GeofenceMap's GEOFENCE_CIRCLE_CLASS.
//
// The separation line was originally a single `stroke-on-surf-v` dashed stroke at
// weight 1.5; on Esri satellite tiles that muted on-surface colour at that weight reads
// as effectively invisible against the imagery. It's now drawn as two stacked polylines
// in the same layer group (so the rebuild's `clearLayers()` still clears both together):
// a solid white "casing" underneath for contrast against any tile colour, then the
// dashed line in the `sec` accent on top, the same casing-plus-accent technique maps
// commonly use to keep a thin line legible over photographic basemaps.
const SEPARATION_LINE_CASING_CLASS = 'stroke-surf-lowest'
const SEPARATION_LINE_CASING_WEIGHT = 5
const SEPARATION_LINE_CASING_OPACITY = 0.85
const SEPARATION_LINE_CLASS = 'stroke-sec'
const SEPARATION_LINE_WEIGHT = 2.5
const SEPARATION_LINE_DASH = '8 6'

// Styled to match GeofenceMap's own precinct fence (GEOFENCE_CIRCLE_CLASS et al.) rather
// than the previous muted `stroke-on-surf-v` at weight 1.5/fillOpacity 0; that pairing
// was also effectively invisible against satellite tiles, and it read as visually
// unrelated to the same boundary drawn on the precinct map. Matching styling here means
// dispatchers see one consistent "this is a geofence" visual language across both map
// surfaces; a nonzero fillOpacity (vs. GeofenceMap's 0.1) is kept lower since this map
// also has two fix markers and a separation line competing for attention inside the
// same circle.
const BOUNDARY_CIRCLE_CLASS = 'fill-sec stroke-sec'
const BOUNDARY_CIRCLE_WEIGHT = 2
const BOUNDARY_CIRCLE_FILL_OPACITY = 0.08
const BOUNDARY_CIRCLE_DASH = '6 6'

// Shared by the Satellite/Street toggle and the Fixes/Precinct frame toggle below, so
// "the active button uses the same selected classes as the tile toggle" (the brief's own
// words) stays true by construction rather than by two copy-pasted class strings.
const CONTROL_BUTTON_SELECTED_CLASS =
  'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase bg-surf-low text-on-surf'
const CONTROL_BUTTON_UNSELECTED_CLASS =
  'px-[10px] py-[5px] rounded-[4px] text-[10px] font-[700] tracking-[0.06em] uppercase text-on-surf-v hover:text-on-surf'

// Vertical offset for the Fixes/Precinct frame toggle, stacked directly beneath the
// Satellite/Street toggle. Set as an inline style rather than a `top-[...]` Tailwind
// class built from a template literal: Tailwind's content scan reads the literal source
// text of class names, so a class string with an interpolated JS constant inside the
// brackets is not a class Tailwind can see, and would silently generate no CSS at all.
// The value clears the toggle above it: its own top-3 (12px) offset plus its own
// rendered height (p-[3px] container padding and py-[5px] button padding, both top and
// bottom, around a text-[10px] label) is roughly 40px, plus a small gap.
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
  // Bumped by "Retry map" to re-run the init effect: same two-cause reasoning as
  // GeofenceMap: a tile outage recovers on its own, but a failed Leaflet import leaves
  // no map to recover, so init has to run again.
  const [initAttempt, setInitAttempt] = useState(0)
  // Needed as an effect dependency (not just `evidence`) for the same reason as
  // GeofenceMap's `mapReady`: a layer rebuild requested before Leaflet finishes loading
  // must still run once it has, rather than being lost because `evidence` didn't change
  // again afterwards.
  const [mapReady, setMapReady] = useState(false)
  // Which extent the map is fitted to: 'fixes' (the default, and the only option when
  // the Fixes/Precinct control isn't rendered) or 'precinct', picked via that control.
  const [frame, setFrame] = useState<FrameTarget>('fixes')

  // Init once. `evidence` changes are applied by the layer-rebuild effect below rather
  // than by tearing the map down and rebuilding it (which would reset the user's pan).
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
        // Chunk or tiles unreachable. The schematic is a correct answer to a narrower
        // question, which beats a blank frame.
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
    // Only initAttempt: this builds the map once (at whatever evidence-derived centre
    // is current when it runs); the rebuild effect below keeps the drawn layers and the
    // fitted view in sync with every subsequent evidence change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initAttempt])

  // Rebuild every drawn layer from `evidence`. Runs once init has produced a map
  // (mapReady) and again on every evidence change thereafter. The view fit is a
  // separate effect below, keyed on `frame` as well, so toggling Fixes/Precinct re-fits
  // the view without clearing and redrawing every marker, line and circle for no reason.
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

      // `interactive: false` on every layer, not just the absence of click/drag
      // handlers: this reinforces the read-only contract by refusing hover/focus
      // affordances that would otherwise suggest the fixes or boundary can be acted on.
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

      // A separation LINE, never a route: a straight dashed segment between the two
      // recorded fixes, drawn only when both exist (a "separation" with one point isn't
      // one). Drawn as a white casing plus a dashed accent line on top (see the
      // SEPARATION_LINE_* comment above), both added to the same layer group so the
      // `clearLayers()` rebuild above clears them together, never one without the other.
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

      // Only ever the CURRENT precinct boundary, explicitly labelled as a reference,
      // never historical fence geometry (see BoundaryReference.provenance in
      // lib/phase/location-evidence.ts). Read through validBoundary, the same guard the
      // framing and the distance row use, so a boundary those two ignore is never drawn
      // here either. The label
      // itself is NOT drawn on the map (no bindTooltip); anchored at the circle centre
      // it would sit directly on top of the driver-phone marker's own label whenever the
      // driver is near the precinct centre, which is the normal case. The modal that
      // hosts this map renders the same BOUNDARY_REFERENCE_LABEL text as a legend line
      // beneath the map instead (see components/domain/LocationEvidencePanel.tsx).
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

  // Fits the view to the active frame (Fixes vs Precinct): see the comment on the
  // layer-rebuild effect above for why this is separate from redrawing the layers
  // themselves. Default view on open is comparisonBounds(evidence, 'fixes'), since
  // `frame` starts at 'fixes' and this runs as soon as mapReady flips true.
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
    // mapReady dependency: applies a source chosen before Leaflet finished loading, same
    // reasoning as GeofenceMap's identical effect.
  }, [source, mapReady])

  // The schematic is an OVERLAY, not a replacement: the map stays mounted underneath so
  // a tile that succeeds after an outage resets the streak and the overlay lifts on its
  // own. See the long comment on GeofenceMap's equivalent return for the bug this avoids.
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

      {/* Only rendered when the default 'fixes' frame would otherwise hide the boundary
          entirely (see BOUNDARY_NEARBY_METRES): a boundary that is already nearby (or
          simply absent) needs no second frame to switch to. */}
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
