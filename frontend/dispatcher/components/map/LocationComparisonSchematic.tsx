// Local SVG schematic comparing the driver's phone fix against the horse tracker's fix at
// a recorded phase. Zero dependencies, zero network: this draws the two RECORDED points
// and, when one is stored, the CURRENT precinct boundary as a labelled reference circle. It
// never fetches a fresh tracker position and never reconstructs historical fence geometry
// (see BOUNDARY_REFERENCE_LABEL in lib/phase/location-evidence.ts); coordinates identify
// devices, not proof of the driver's presence, so the markers are distinguished by shape
// and text as well as colour.
//
// Also the tile-failure fallback for LocationComparisonMap (components/map/LocationComparisonMap.tsx):
// whatever this draws is what a dispatcher sees when the basemap cannot load, so its own
// on-screen size and label placement have to be correct on their own, not just "good enough
// for a disclosure panel".

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
// A rectangular viewBox (rather than GeofenceSchematic's square) because this diagram has
// to fit two independent points plus a boundary circle, not one circle centred on itself.
const VIEWBOX_WIDTH = 320
const VIEWBOX_HEIGHT = 220
// Keeps every drawn element (markers, boundary circle, labels) off the viewBox edge.
const PADDING_PX = 34

// Hard cap on the SVG's rendered width, applied via an inline `max-width` style rather
// than a Tailwind arbitrary-value class (`max-w-[360px]`): Tailwind's content scanner
// needs that exact literal string present in source text, and building it from this
// constant via template interpolation would leave the class un-generated in the actual
// CSS output while still looking correct in the diff. An inline style has no such
// requirement and reads the constant directly. `mx-auto` (a plain, static class) keeps
// it centred when the container is wider than the cap.
//
// An SVG's `viewBox` only fixes its INTERNAL coordinate system: the browser still scales
// that coordinate system up to fill whatever CSS box the element is given, and every unit
// inside (including font-size) scales with it. `LocationEvidencePanel` renders this at
// `w-full h-auto` inside a `size="lg"` Modal, which stretched the SVG to that modal's full
// width (500-600px+) and, with it, ~9px label text to ~16px; overlapping labels that read
// fine at the viewBox's own 320px. Capping the rendered width keeps the scale factor (and
// therefore the font sizes below) close to 1, whatever container this is dropped into.
const MAX_RENDER_WIDTH_PX = 360

// Metres per degree of latitude (and, scaled by cos(latitude), of longitude): a constant
// for a local equirectangular projection, not a geodesic one. Good enough for a schematic
// spanning at most a few hundred kilometres; explicitly NOT haversineMetres-consistent, as
// the plan allows.
const M_PER_DEG = 111_320

// Half-width of the frame drawn when there is nothing to fit an extent to (a single fix, no
// boundary): coincident points, or one lone fix. Keeps the marker from filling the frame.
const DEFAULT_HALF_EXTENT_METRES = 100

// Below this pixel gap, two markers are treated as coincident: no line is drawn (a
// zero-length "separation" line is not a line), and the two text labels are pushed apart
// vertically instead of overlapping each other.
const COINCIDENT_EPSILON_PX = 0.5

const MARKER_RADIUS_PX = 6
const SQUARE_HALF_PX = 5.5
const LABEL_GAP_PX = 9
// Reduced from the diagram's very first cut (9px) now that MAX_RENDER_WIDTH_PX bounds the
// on-screen scale factor to ~1.1x of the viewBox: 9px would render at ~10px, which is
// legible but leaves less clearance before adjacent labels touch at tight separations.
const LABEL_FONT_SIZE = 8
const COINCIDENT_LABEL_OFFSET_PX = 11

// A marker's away-vector is rarely EXACTLY horizontal or vertical, so anchoring on any
// nonzero x-component would flip start/end on almost every render for a nearly-vertical
// separation, a difference no one asked for and that would make snapshot-style
// assertions flaky. Anchor flips only once the horizontal component is a clear majority
// of the (unit) away-vector; otherwise the label stays centred under/over the marker.
const HORIZONTAL_ANCHOR_THRESHOLD = 0.3

// Boundary caption: rough text width in px, used only to keep the caption inside the
// viewBox; not a real font metric, which SVG has no synchronous way to measure without
// a DOM round-trip this component (also used server-side in tests) shouldn't depend on.
// 0.55 * fontSize per character is a standard estimate for a mixed-case sans-serif body.
const BOUNDARY_LABEL_CHAR_WIDTH_FACTOR = 0.55
const BOUNDARY_LABEL_FONT_SIZE = 8
// A boundary circle this small on screen has no room for its own caption without the
// text swallowing the circle (or spilling over neighbouring markers): draw the circle
// alone rather than a label no one could read anyway.
const MIN_BOUNDARY_RADIUS_FOR_CAPTION_PX = 6

// Nudges the separation-distance label off the dashed line itself rather than centred on
// it, and gives it a solid halo so the dash pattern doesn't cut through the digits.
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

/** Metres east/north of (originLat, originLng): see the M_PER_DEG comment above. */
function project(coords: Coords, originLat: number, originLng: number): Point {
  return {
    x: (coords.lng - originLng) * Math.cos(toRadians(originLat)) * M_PER_DEG,
    y: (coords.lat - originLat) * M_PER_DEG,
  }
}

/**
 * Where to draw a marker's text label: offset away from `other` (the other recorded fix)
 * along the line joining them, so the label lands on the side that can never be crossed
 * by the separation line or sit under the other marker.
 *
 * `other === null` (a lone fix, nothing to steer away from) falls back to the diagram's
 * original layout (straight down from the marker, centred), which is also what a
 * zero-length away-vector (defensive; `coincident` is handled by the caller before this
 * is reached) collapses to.
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
    // Never fabricate a distance: only append "N m apart" when a separation was actually
    // measured (constraint 3, "No zero fallback"; see task-2-brief.md).
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
 *
 * Fits whatever is actually drawn: two fixes and a boundary; one lone fix; two coincident
 * fixes; two fixes hundreds of kilometres apart. Degenerate extents (a single point, or no
 * boundary) fall back to a fixed default scale rather than dividing by zero.
 */
export function LocationComparisonSchematic({ evidence, className }: Props) {
  const { driverFix, trackerFix, separationMetres } = evidence
  // The same boundary the live map's default frame would show, and only that: a
  // boundary far from every fix is left out here too, otherwise fitting it would shrink
  // two fixes kilometres apart onto one pixel and this fallback would show LESS than the
  // map it stands in for. See boundaryInDefaultFrame in lib/phase/location-evidence.ts.
  const boundary = boundaryInDefaultFrame(evidence)

  // Origin for the local projection: the mean latitude/longitude across everything that
  // will actually be drawn. cos(originLat) is what keeps a degree of longitude the right
  // width relative to a degree of latitude at this latitude band.
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

  // Bounding box in metres (east/north of the origin) across every drawn item: fix points,
  // and the boundary circle's full footprint (centre ± radius), not just its centre.
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

  // px-per-metre. A degenerate extent (nothing drawn, or everything coincident with no
  // boundary) falls back to a fixed default "zoom" rather than dividing by zero.
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

  // Driver/tracker label placement: steer each label away from the OTHER marker so
  // neither ever sits on top of the separation line or the other marker's own label.
  // Coincident fixes keep the previous stacked-above/below layout instead (the "other"
  // marker to steer away from is, by definition, right on top of this one).
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
  // A circle too small on screen has no room for its caption text without the label
  // swallowing it: draw the circle alone rather than an illegible or overflowing label.
  const showBoundaryCaption = showBoundary && boundaryRadiusPx >= MIN_BOUNDARY_RADIUS_FOR_CAPTION_PX

  // Clamp the caption's centre x so its estimated text box never runs off the viewBox:
  // it was previously anchored straight over the circle's own (unclamped) centre, which
  // clipped at the left edge for any boundary drawn near the frame's edge.
  const boundaryLabelHalfWidthPx =
    (BOUNDARY_REFERENCE_LABEL.length * BOUNDARY_LABEL_CHAR_WIDTH_FACTOR * BOUNDARY_LABEL_FONT_SIZE) / 2
  const boundaryLabelX = boundaryCentrePx
    ? Math.min(
      VIEWBOX_WIDTH - boundaryLabelHalfWidthPx,
      Math.max(boundaryLabelHalfWidthPx, boundaryCentrePx.x),
    )
    : 0

  // Scale bar: same niceScaleMetres rounding as GeofenceSchematic, sized off this
  // diagram's own px-per-metre rather than importing its fraction-of-a-circle constant,
  // which assumes a geometry this component doesn't have.
  const metresPerPixel = scale > 0 ? 1 / scale : 0
  const scaleMetres = niceScaleMetres(SCALE_BAR_TARGET_PX * metresPerPixel)
  const scaleWidthPx = scaleMetres * scale

  // Separation label: offset perpendicular to the dashed line (not just up, which
  // collided with the line whenever it ran more horizontally than vertically) and given
  // a solid halo (paint-order: stroke) so the dash pattern behind it doesn't cut through
  // the digits.
  let separationLabelX = 0
  let separationLabelY = 0
  if (driverPx && trackerPx) {
    const dx = trackerPx.x - driverPx.x
    const dy = trackerPx.y - driverPx.y
    const length = Math.hypot(dx, dy)
    // Rotate the line direction 90° for a perpendicular unit vector; a zero-length line
    // (coincident fixes) never reaches this branch because showLine/the text below both
    // require !coincident.
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
