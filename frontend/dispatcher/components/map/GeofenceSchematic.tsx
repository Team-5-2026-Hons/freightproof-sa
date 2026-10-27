'use client'

import type { LatLngPair } from '@shared/lib/types/precinct'
import { enclosingRadiusMetres } from '@/lib/map/polygon'

const METRES_PER_DEGREE = (Math.PI * 6_371_008.8) / 180

const VIEWBOX = 200
const CIRCLE_RADIUS_PX = 62

export const SCALE_BAR_TARGET_FRACTION = 0.3

const MIN_RENDERABLE_RADIUS_METRES = 1

const MIN_SCALE_METRES = 1

interface GeofenceSchematicProps {
  radiusMetres: number
  polygon?: readonly LatLngPair[] | null
  centre?: LatLngPair
  className?: string
}

/**
 * Rounds `metres` down to the nearest 1/2/5 × power of ten, so a scale bar reads "50 m"
 * rather than "63 m". Exported for testing. Never exceeds `metres` for a valid
 * positive-finite input; NaN and Infinity are guarded explicitly since neither satisfies `<= 0`.
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
 * Used as the list-card thumbnail and as the fallback when map tiles can't be reached —
 * shows no basemap, only distance. Colour comes from Tailwind utility classes since this
 * codebase's `globals.css` has no `:root` variable block to target instead.
 */
export function GeofenceSchematic({ radiusMetres, polygon = null, centre: pin, className }: GeofenceSchematicProps) {
  const outline = polygon !== null && polygon.length >= 3 && pin !== undefined ? polygon : null
  const extentMetres = outline !== null && pin !== undefined ? enclosingRadiusMetres(outline, pin) : radiusMetres
  const safeRadiusMetres =
    Number.isFinite(extentMetres) && extentMetres > 0 ? extentMetres : MIN_RENDERABLE_RADIUS_METRES

  const metresPerPixel = safeRadiusMetres / CIRCLE_RADIUS_PX
  const scaleMetres = niceScaleMetres(metresPerPixel * (VIEWBOX * SCALE_BAR_TARGET_FRACTION))
  const scaleWidthPx = scaleMetres / metresPerPixel

  const centre = VIEWBOX / 2

  const outlinePoints =
    outline !== null && pin !== undefined
      ? outline
          .map(([lat, lng]) => {
            const eastMetres = (lng - pin[1]) * METRES_PER_DEGREE * Math.cos((pin[0] * Math.PI) / 180)
            const northMetres = (lat - pin[0]) * METRES_PER_DEGREE
            return `${(centre + eastMetres / metresPerPixel).toFixed(1)},${(centre - northMetres / metresPerPixel).toFixed(1)}`
          })
          .join(' ')
      : null

  if (outlinePoints !== null) {
    return (
      <svg
        viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
        className={className}
        role="img"
        aria-label={`Diagram of a property outline with ${outline?.length ?? 0} corners`}
      >
        <polygon
          data-testid="schematic-fence-outline"
          points={outlinePoints}
          className="fill-sec stroke-sec"
          fillOpacity={0.1}
          strokeWidth={1.5}
        />
        <circle cx={centre} cy={centre} r={4} className="fill-sec" />
        <ScaleBar scaleMetres={scaleMetres} scaleWidthPx={scaleWidthPx} />
      </svg>
    )
  }

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      className={className}
      role="img"
      aria-label={`Diagram of a ${safeRadiusMetres} m geofence`}
    >
      <circle
        data-testid="schematic-fence-circle"
        cx={centre}
        cy={centre}
        r={CIRCLE_RADIUS_PX}
        className="fill-sec stroke-sec"
        fillOpacity={0.1}
        strokeWidth={1.5}
      />

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

      <circle cx={centre} cy={centre} r={4} className="fill-sec" />

      <ScaleBar scaleMetres={scaleMetres} scaleWidthPx={scaleWidthPx} />
    </svg>
  )
}

/** Metre scale bar, bottom left — shared by the circle and outline diagrams. */
function ScaleBar({ scaleMetres, scaleWidthPx }: { scaleMetres: number; scaleWidthPx: number }) {
  return (
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
  )
}
