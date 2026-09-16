// Local SVG schematic comparing the driver's phone fix against the horse tracker's fix at
// a recorded phase. Zero dependencies, zero network: draws the two RECORDED points and,
// when known, the CURRENT precinct boundary as a labelled reference circle (see
// BOUNDARY_REFERENCE_LABEL in lib/phase/location-evidence.ts). Also the tile-failure
// fallback for LocationComparisonMap, so its own sizing has to be correct standalone.

import {
  BOUNDARY_REFERENCE_LABEL,
  FIX_LABELS,
  boundaryInDefaultFrame,
  type LocationEvidence,
} from '@/lib/phase/location-evidence'
import { formatSeparation, type Coords } from '@/lib/phase/geo'
import { niceScaleMetres } from './GeofenceSchematic'

interface Props {
  evidence: LocationEvidence
  className?: string
}

// ── Layout constants ────────────────────────────────────────────────────────────
// Rectangular, not square like GeofenceSchematic's, since this fits two points plus a boundary circle.
const VIEWBOX_WIDTH = 320
const VIEWBOX_HEIGHT = 220
// Keeps every drawn element off the viewBox edge.
const PADDING_PX = 34

// Inline `max-width` style, not a Tailwind arbitrary-value class: Tailwind's content
// scanner needs a literal class string, not one built via template interpolation.
// An SVG's viewBox only fixes its internal coordinate system — the browser still scales
// it to fill the CSS box, which stretched labels to ~16px inside a `size="lg"` Modal.
// This caps the scale factor (and font sizes) close to 1 in any container.
const MAX_RENDER_WIDTH_PX = 360

// Local equirectangular projection, not geodesic — good enough for a schematic spanning
// at most a few hundred kilometres.
const M_PER_DEG = 111_320

// Half-width of the frame when there's nothing to fit an extent to (a lone or coincident fix).
const DEFAULT_HALF_EXTENT_METRES = 100

// Below this pixel gap, two markers are treated as coincident: no line drawn, labels pushed apart vertically.
const COINCIDENT_EPSILON_PX = 0.5

const MARKER_RADIUS_PX = 6
const SQUARE_HALF_PX = 5.5
const LABEL_GAP_PX = 9
const LABEL_FONT_SIZE = 8
const COINCIDENT_LABEL_OFFSET_PX = 11

// Anchor flips (start/end) only once the horizontal component is a clear majority of the
// away-vector, so a near-vertical separation doesn't flip on almost every render.
const HORIZONTAL_ANCHOR_THRESHOLD = 0.3

// Rough estimate (0.55 * fontSize per char), used only to keep the caption inside the
// viewBox — SVG has no synchronous way to measure real text width.
const BOUNDARY_LABEL_CHAR_WIDTH_FACTOR = 0.55
const BOUNDARY_LABEL_FONT_SIZE = 8
// A boundary circle this small has no room for a caption without the text swallowing it.
const MIN_BOUNDARY_RADIUS_FOR_CAPTION_PX = 6

// Nudges the separation-distance label off the dashed line, with a solid halo so the dash doesn't cut through it.
const SEPARATION_LABEL_PERP_OFFSET_PX = 7
const SEPARATION_LABEL_HALO_STROKE_WIDTH = 3

const SCALE_BAR_TARGET_PX = 64
const SCALE_BAR_MARGIN_PX = 14

interface Point {
  x: number
  y: number
}

type TextAnchor = 'start' | 'middle' | 'end'

interface LabelPlacement extends Point {
  anchor: TextAnchor
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

/** Metres east/north of (originLat, originLng). */
function project(coords: Coords, originLat: number, originLng: number): Point {
  return {
    x: (coords.lng - originLng) * Math.cos(toRadians(originLat)) * M_PER_DEG,
    y: (coords.lat - originLat) * M_PER_DEG,
  }
}

/**
 * Where to draw a marker's text label: offset away from `other` along the line joining
 * them, so it never sits on the separation line or the other marker. `other === null`
 * (a lone fix) falls back to straight down from the marker, centred.
 */
function labelPlacement(marker: Point, other: Point | null, offsetPx: number): LabelPlacement {
  let dirX = 0
  let dirY = 1

  if (other !== null) {
    const dx = marker.x - other.x
    const dy = marker.y - other.y
    const magnitude = Math.hypot(dx, dy)
    if (magnitude > 0) {
      dirX = dx / magnitude
      dirY = dy / magnitude
    }
  }

  let anchor: TextAnchor = 'middle'
  if (dirX > HORIZONTAL_ANCHOR_THRESHOLD) anchor = 'start'
  else if (dirX < -HORIZONTAL_ANCHOR_THRESHOLD) anchor = 'end'

  return {
    x: marker.x + dirX * offsetPx,
    y: marker.y + dirY * offsetPx,
    anchor,
  }
}

function buildAriaLabel(evidence: LocationEvidence): string {
  const { driverFix, trackerFix, separationMetres } = evidence
  if (driverFix && trackerFix) {
    // Never fabricate a distance: only append "N m apart" when one was actually measured.
    const separationFragment = separationMetres !== null
      ? `, ${formatSeparation(separationMetres)} apart`
      : ''
    return `Comparison of ${FIX_LABELS.driver_phone} and ${FIX_LABELS.horse_tracker} recorded positions`
      + separationFragment
  }
  if (driverFix) return `${FIX_LABELS.driver_phone} recorded position; ${FIX_LABELS.horse_tracker} not recorded`
  if (trackerFix) return `${FIX_LABELS.horse_tracker} recorded position; ${FIX_LABELS.driver_phone} not recorded`
  return 'No location fixes recorded'
}

/**
 * Pure SVG schematic (never a basemap) placing the driver phone fix, the horse tracker
 * fix, and (when known) the current precinct boundary on one locally-projected diagram.
 * Fits whatever is actually drawn, and falls back to a fixed default scale for degenerate
 * extents rather than dividing by zero.
 */
export function LocationComparisonSchematic({ evidence, className }: Props) {
  const { driverFix, trackerFix, separationMetres } = evidence
  // The same boundary the live map's default frame would show — a far boundary is left
  // out here too, so this fallback doesn't show less than the map it stands in for.
  const boundary = boundaryInDefaultFrame(evidence)

  // Origin for the local projection: the mean lat/lng across everything drawn.
  const extentCoords: Coords[] = [
    ...(driverFix ? [driverFix.coords] : []),
    ...(trackerFix ? [trackerFix.coords] : []),
    ...(boundary ? [boundary.coords] : []),
  ]
  const originLat = extentCoords.length > 0
    ? extentCoords.reduce((sum, c) => sum + c.lat, 0) / extentCoords.length
    : 0
  const originLng = extentCoords.length > 0
    ? extentCoords.reduce((sum, c) => sum + c.lng, 0) / extentCoords.length
    : 0

  // Bounding box in metres across every drawn item: fix points, and the boundary
  // circle's full footprint (centre +/- radius), not just its centre.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  function extend(x: number, y: number): void {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x)
    minY = Math.min(minY, y); maxY = Math.max(maxY, y)
  }
  for (const coords of extentCoords) {
    const point = project(coords, originLat, originLng)
    extend(point.x, point.y)
  }
  if (boundary) {
    const centre = project(boundary.coords, originLat, originLng)
    const r = boundary.radiusMetres
    extend(centre.x - r, centre.y - r)
    extend(centre.x + r, centre.y + r)
  }

  const drawableWidthPx = VIEWBOX_WIDTH - PADDING_PX * 2
  const drawableHeightPx = VIEWBOX_HEIGHT - PADDING_PX * 2
  const bboxWidth = Number.isFinite(maxX - minX) ? maxX - minX : 0
  const bboxHeight = Number.isFinite(maxY - minY) ? maxY - minY : 0

  // px-per-metre; a degenerate extent falls back to a fixed default "zoom".
  const defaultScale = drawableWidthPx / (DEFAULT_HALF_EXTENT_METRES * 2)
  let scale: number
  if (bboxWidth <= 0 && bboxHeight <= 0) {
    scale = defaultScale
  } else {
    const scaleX = bboxWidth > 0 ? drawableWidthPx / bboxWidth : Infinity
    const scaleY = bboxHeight > 0 ? drawableHeightPx / bboxHeight : Infinity
    scale = Math.min(scaleX, scaleY)
    if (!Number.isFinite(scale) || scale <= 0) scale = defaultScale
  }

  const bboxCentreX = Number.isFinite(minX) && Number.isFinite(maxX) ? (minX + maxX) / 2 : 0
  const bboxCentreY = Number.isFinite(minY) && Number.isFinite(maxY) ? (minY + maxY) / 2 : 0
  const viewCentreX = VIEWBOX_WIDTH / 2
  const viewCentreY = VIEWBOX_HEIGHT / 2

  function toPx(point: Point): Point {
    return {
      x: viewCentreX + (point.x - bboxCentreX) * scale,
      // North is +y in metres but up is -y in SVG space, hence the flip.
      y: viewCentreY - (point.y - bboxCentreY) * scale,
    }
  }

  const driverPx = driverFix ? toPx(project(driverFix.coords, originLat, originLng)) : null
  const trackerPx = trackerFix ? toPx(project(trackerFix.coords, originLat, originLng)) : null

  const coincident =
    driverPx !== null && trackerPx !== null &&
    Math.abs(driverPx.x - trackerPx.x) < COINCIDENT_EPSILON_PX &&
    Math.abs(driverPx.y - trackerPx.y) < COINCIDENT_EPSILON_PX

  const showLine = driverPx !== null && trackerPx !== null && !coincident

  // Coincident fixes keep a stacked above/below layout instead of steering away from
  // the other marker, since it's right on top of this one.
  const driverLabel = driverPx
    ? (coincident
      ? { x: driverPx.x, y: driverPx.y - COINCIDENT_LABEL_OFFSET_PX, anchor: 'middle' as const }
      : labelPlacement(driverPx, trackerPx, MARKER_RADIUS_PX + LABEL_GAP_PX))
    : null
  const trackerLabel = trackerPx
    ? (coincident
      ? { x: trackerPx.x, y: trackerPx.y + COINCIDENT_LABEL_OFFSET_PX + LABEL_GAP_PX, anchor: 'middle' as const }
      : labelPlacement(trackerPx, driverPx, SQUARE_HALF_PX + LABEL_GAP_PX))
    : null

  const boundaryCentrePx = boundary ? toPx(project(boundary.coords, originLat, originLng)) : null
  const boundaryRadiusPx = boundary ? boundary.radiusMetres * scale : 0
  const showBoundary = boundaryCentrePx !== null && Number.isFinite(boundaryRadiusPx) && boundaryRadiusPx > 0
  const showBoundaryCaption = showBoundary && boundaryRadiusPx >= MIN_BOUNDARY_RADIUS_FOR_CAPTION_PX

  // Clamps the caption's centre x so its estimated text box never runs off the viewBox.
  const boundaryLabelHalfWidthPx =
    (BOUNDARY_REFERENCE_LABEL.length * BOUNDARY_LABEL_CHAR_WIDTH_FACTOR * BOUNDARY_LABEL_FONT_SIZE) / 2
  const boundaryLabelX = boundaryCentrePx
    ? Math.min(
      VIEWBOX_WIDTH - boundaryLabelHalfWidthPx,
      Math.max(boundaryLabelHalfWidthPx, boundaryCentrePx.x),
    )
    : 0

  // Same niceScaleMetres rounding as GeofenceSchematic, sized off this diagram's own px-per-metre.
  const metresPerPixel = scale > 0 ? 1 / scale : 0
  const scaleMetres = niceScaleMetres(SCALE_BAR_TARGET_PX * metresPerPixel)
  const scaleWidthPx = scaleMetres * scale

  // Offset perpendicular to the dashed line, with a solid halo (paint-order: stroke) so
  // the dash pattern doesn't cut through the digits.
  let separationLabelX = 0
  let separationLabelY = 0
  if (driverPx && trackerPx) {
    const dx = trackerPx.x - driverPx.x
    const dy = trackerPx.y - driverPx.y
    const length = Math.hypot(dx, dy)
    // Rotates the line direction 90 degrees for a perpendicular unit vector.
    const perpX = length > 0 ? -dy / length : 0
    const perpY = length > 0 ? dx / length : -1
    separationLabelX = (driverPx.x + trackerPx.x) / 2 + perpX * SEPARATION_LABEL_PERP_OFFSET_PX
    separationLabelY = (driverPx.y + trackerPx.y) / 2 + perpY * SEPARATION_LABEL_PERP_OFFSET_PX
  }

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      className={`mx-auto ${className ?? ''}`}
      style={{ maxWidth: MAX_RENDER_WIDTH_PX }}
      role="img"
      aria-label={buildAriaLabel(evidence)}
    >
      {showBoundary && boundaryCentrePx && (
        <g>
          <circle
            data-testid="boundary-circle"
            cx={boundaryCentrePx.x}
            cy={boundaryCentrePx.y}
            r={boundaryRadiusPx}
            className="stroke-on-surf-v"
            fillOpacity={0}
            strokeOpacity={0.45}
            strokeWidth={1.5}
            strokeDasharray="4 3"
          />
          {showBoundaryCaption && (
            <text
              x={boundaryLabelX}
              y={boundaryCentrePx.y - boundaryRadiusPx - 5}
              textAnchor="middle"
              className="fill-on-surf-v"
              fontSize={BOUNDARY_LABEL_FONT_SIZE}
              fontWeight={600}
            >
              {BOUNDARY_REFERENCE_LABEL}
            </text>
          )}
        </g>
      )}

      {showLine && driverPx && trackerPx && (
        <g>
          <line
            data-testid="separation-line"
            x1={driverPx.x}
            y1={driverPx.y}
            x2={trackerPx.x}
            y2={trackerPx.y}
            className="stroke-on-surf-v"
            strokeWidth={1.5}
            strokeDasharray="5 3"
          />
          {separationMetres !== null && (
            <text
              x={separationLabelX}
              y={separationLabelY}
              textAnchor="middle"
              className="fill-on-surf-v stroke-surf"
              fontSize={LABEL_FONT_SIZE}
              fontWeight={700}
              strokeWidth={SEPARATION_LABEL_HALO_STROKE_WIDTH}
              strokeLinejoin="round"
              style={{ fontVariantNumeric: 'tabular-nums', paintOrder: 'stroke' }}
            >
              {formatSeparation(separationMetres)}
            </text>
          )}
        </g>
      )}

      {driverPx && driverLabel && (
        <g>
          <circle
            data-testid="fix-driver_phone"
            cx={driverPx.x}
            cy={driverPx.y}
            r={MARKER_RADIUS_PX}
            className="fill-sec stroke-surf"
            strokeWidth={1.5}
          />
          <text
            x={driverLabel.x}
            y={driverLabel.y}
            textAnchor={driverLabel.anchor}
            className="fill-sec"
            fontSize={LABEL_FONT_SIZE}
            fontWeight={700}
          >
            {FIX_LABELS.driver_phone}
          </text>
        </g>
      )}

      {trackerPx && trackerLabel && (
        <g>
          <rect
            data-testid="fix-horse_tracker"
            x={trackerPx.x - SQUARE_HALF_PX}
            y={trackerPx.y - SQUARE_HALF_PX}
            width={SQUARE_HALF_PX * 2}
            height={SQUARE_HALF_PX * 2}
            className="fill-chain stroke-surf"
            strokeWidth={1.5}
          />
          <text
            x={trackerLabel.x}
            y={trackerLabel.y}
            textAnchor={trackerLabel.anchor}
            className="fill-chain"
            fontSize={LABEL_FONT_SIZE}
            fontWeight={700}
          >
            {FIX_LABELS.horse_tracker}
          </text>
        </g>
      )}

      {/* Scale bar, bottom left: same visual language as GeofenceSchematic's. */}
      <g transform={`translate(${SCALE_BAR_MARGIN_PX}, ${VIEWBOX_HEIGHT - SCALE_BAR_MARGIN_PX})`}>
        <line x1={0} y1={0} x2={scaleWidthPx} y2={0} className="stroke-on-surf-v" strokeWidth={1.5} />
        <line x1={0} y1={-3} x2={0} y2={3} className="stroke-on-surf-v" strokeWidth={1.5} />
        <line x1={scaleWidthPx} y1={-3} x2={scaleWidthPx} y2={3} className="stroke-on-surf-v" strokeWidth={1.5} />
        <text
          data-testid="schematic-scale-label"
          x={scaleWidthPx / 2}
          y={-6}
          textAnchor="middle"
          className="fill-on-surf-v"
          fontSize={9}
          fontWeight={700}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {scaleMetres} m
        </text>
      </g>
    </svg>
  )
}
