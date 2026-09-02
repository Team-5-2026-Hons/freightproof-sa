'use client'

// The circle always occupies the same fraction of the box, whatever the radius — the
// diagram's job is to make the radius legible against a scale bar, not to imply a
// zoom level it does not have. Everything else is derived from these two numbers.
const VIEWBOX = 200
const CIRCLE_RADIUS_PX = 62

// The scale bar targets roughly a third of the circle's diameter on screen — big enough
// to read at a glance without a ruler, small enough that the circle stays the dominant
// shape in the diagram.
const SCALE_BAR_TARGET_FRACTION = 0.3

// Fallback used only when the caller hands this zero-dependency component a radius it
// cannot draw (<= 0, NaN, Infinity). Real precinct radii are floored at 50 m by
// validation elsewhere (GPS_TOLERANCE_METRES) — this purely stops the SVG geometry
// (division by the radius) from going to zero, negative or Infinity.
const MIN_RENDERABLE_RADIUS_METRES = 1

// Floor for `niceScaleMetres`'s own degenerate inputs (NaN, Infinity, <= 0) — kept
// separate from MIN_RENDERABLE_RADIUS_METRES because the two guards protect different
// call sites (the component's radius vs. the scale function's general contract).
const MIN_SCALE_METRES = 1

interface GeofenceSchematicProps {
  radiusMetres: number
  className?: string
}

/**
 * Rounds `metres` down to the nearest 1/2/5 × power of ten.
 *
 * A scale bar reading "63 m" is noise; one reading "50 m" is a ruler. Exported for
 * testing because the rounding is the only logic here worth getting wrong.
 *
 * Never returns more than `metres` for a valid positive-finite input — the previous
 * version clamped every result up to a minimum of 1, which was correct for the
 * `metres <= 0` fallback but silently broke "rounds down" for legitimate sub-1 inputs
 * (0.4 was rounding UP to 1). NaN and Infinity are guarded explicitly rather than
 * relying on `<= 0`, which neither of them satisfies.
 */
export function niceScaleMetres(metres: number): number {
  if (!Number.isFinite(metres) || metres <= 0) return MIN_SCALE_METRES
  const magnitude = Math.pow(10, Math.floor(Math.log10(metres)))
  const normalised = metres / magnitude
  const step = normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1
  return step * magnitude
}

/**
 * Zero-dependency geofence diagram: the fence circle drawn against a metre scale bar.
 *
 * Serves three roles — the list-card thumbnail, the fallback when map tiles cannot be
 * reached, and the always-correct answer to "how far is 200 m". It deliberately shows
 * no basemap: it makes no claim about what is on the ground, only about distance.
 *
 * Colour comes from the Tailwind design tokens (`sec`, `on-surf-v` in
 * tailwind.config.ts) via utility classes on the SVG elements, not CSS custom
 * properties — this codebase's `globals.css` has no `:root` variable block, only the
 * Tailwind colour map, so `fill`/`stroke` utilities are the correct way to reach it
 * from SVG (they compile to real hex values Tailwind already generates elsewhere).
 */
export function GeofenceSchematic({ radiusMetres, className }: GeofenceSchematicProps) {
  // Guard first: a non-positive, NaN or Infinite radius would send metresPerPixel to
  // zero/negative/NaN and scaleWidthPx to Infinity, producing broken SVG geometry. Not
  // reachable through the create/edit form today (validation floors it at 50 m), but
  // this component advertises itself as the always-renders fallback, so it has to
  // survive being handed one directly.
  const safeRadiusMetres =
    Number.isFinite(radiusMetres) && radiusMetres > 0 ? radiusMetres : MIN_RENDERABLE_RADIUS_METRES

  const metresPerPixel = safeRadiusMetres / CIRCLE_RADIUS_PX
  const scaleMetres = niceScaleMetres(metresPerPixel * (VIEWBOX * SCALE_BAR_TARGET_FRACTION))
  const scaleWidthPx = scaleMetres / metresPerPixel

  const centre = VIEWBOX / 2

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className={className}
      role="img"
      aria-label={`Diagram of a ${safeRadiusMetres} m geofence`}
    >
      {/* Fence. sec because this is the element under edit, not a status. */}
      <circle
        data-testid="schematic-fence-circle"
        cx={centre}
        cy={centre}
        r={CIRCLE_RADIUS_PX}
        className="fill-sec stroke-sec"
        fillOpacity={0.1}
        strokeWidth={1.5}
      />

      {/* Radius rule, centre to edge, with the measurement on it. */}
      <line
        x1={centre}
        y1={centre}
        x2={centre + CIRCLE_RADIUS_PX}
        y2={centre}
        className="stroke-sec"
        strokeWidth={1}
        strokeDasharray="3 3"
      />
      <text
        x={centre + CIRCLE_RADIUS_PX / 2}
        y={centre - 6}
        textAnchor="middle"
        className="fill-on-surf-v"
        fontSize={11}
        fontWeight={700}
        letterSpacing="0.03em"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {safeRadiusMetres} m
      </text>

      {/* Centre pin. */}
      <circle cx={centre} cy={centre} r={4} className="fill-sec" />

      {/* Scale bar, bottom left. */}
      <g transform={`translate(14, ${VIEWBOX - 18})`}>
        <line
          data-testid="schematic-scale-line"
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
          data-testid="schematic-scale-label"
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
  )
}
