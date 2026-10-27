// Plane geometry for precinct outlines. Pure and unit-tested.
//
// TypeScript twin of backend/app/core/polygon.py, and the validation rules mirror
// backend/app/schemas/organisations.py — the form checks here so a dispatcher sees the
// problem while drawing, but the server re-checks everything and is the authority.
//
// Same flat projection as the backend: metres east/north of a local origin. A precinct is
// at most a few kilometres across, where that flattening is off by well under a metre.

import type { LatLngPair } from '@shared/lib/types/precinct'
import { GEOFENCE_RADIUS_MAX } from '@shared/lib/validation/constants'

const EARTH_RADIUS_METRES = 6_371_008.8
const METRES_PER_DEGREE = (Math.PI * EARTH_RADIUS_METRES) / 180

export const MIN_OUTLINE_CORNERS = 3
export const MAX_OUTLINE_CORNERS = 500
export const MIN_OUTLINE_AREA_M2 = 400
export const MAX_OUTLINE_AREA_M2 = Math.PI * GEOFENCE_RADIUS_MAX ** 2
export const PIN_MAX_OUTSIDE_OUTLINE_METRES = 100

export const STARTER_RECTANGLE_HALF_METRES = 50

const SQUARE_METRES_PER_HECTARE = 10_000

type Point = [number, number]

function projector(originLat: number, originLng: number): (p: LatLngPair) => Point {
  const metresPerDegreeLng = METRES_PER_DEGREE * Math.cos((originLat * Math.PI) / 180)
  return ([lat, lng]) => [(lng - originLng) * metresPerDegreeLng, (lat - originLat) * METRES_PER_DEGREE]
}

function edges(ring: Point[]): Array<[Point, Point]> {
  return ring.map((p, i) => [p, ring[(i + 1) % ring.length]])
}

function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function cornerAverage(polygon: readonly LatLngPair[]): LatLngPair {
  const lat = polygon.reduce((sum, p) => sum + p[0], 0) / polygon.length
  const lng = polygon.reduce((sum, p) => sum + p[1], 0) / polygon.length
  return [lat, lng]
}

/** Ray casting: odd number of edge crossings going east = inside. */
export function contains(polygon: readonly LatLngPair[], point: LatLngPair): boolean {
  const ring = polygon.map(projector(point[0], point[1]))
  let inside = false
  for (const [[x1, y1], [x2, y2]] of edges(ring)) {
    if (y1 > 0 !== y2 > 0) {
      const crossingX = x1 + ((0 - y1) * (x2 - x1)) / (y2 - y1)
      if (crossingX > 0) inside = !inside
    }
  }
  return inside
}

/** Shortest distance in metres from the point to any edge, inside or outside. */
export function distanceToBoundaryMetres(polygon: readonly LatLngPair[], point: LatLngPair): number {
  const ring = polygon.map(projector(point[0], point[1]))
  return Math.min(...edges(ring).map(([a, b]) => segmentDistance([0, 0], a, b)))
}

/** 0 inside the outline, otherwise metres to its nearest edge — the backend verdict's measure. */
export function outsideByMetres(polygon: readonly LatLngPair[], point: LatLngPair): number {
  return contains(polygon, point) ? 0 : distanceToBoundaryMetres(polygon, point)
}

/** Shoelace area in m², projected around the corner average so corner order doesn't matter. */
export function areaSquareMetres(polygon: readonly LatLngPair[]): number {
  const [lat, lng] = cornerAverage(polygon)
  const ring = polygon.map(projector(lat, lng))
  const twice = edges(ring).reduce((sum, [a, b]) => sum + (a[0] * b[1] - b[0] * a[1]), 0)
  return Math.abs(twice) / 2
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}

function onSegment(p: Point, q: Point, r: Point): boolean {
  return Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) &&
    Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1])
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c)
  const o2 = orientation(a, b, d)
  const o3 = orientation(c, d, a)
  const o4 = orientation(c, d, b)
  if (o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0 && (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0)) return true
  return (o1 === 0 && onSegment(a, c, b)) || (o2 === 0 && onSegment(a, d, b)) ||
    (o3 === 0 && onSegment(c, a, d)) || (o4 === 0 && onSegment(c, b, d))
}

/** No repeated corners and no two non-neighbouring edges touching (no figure-of-eight). */
export function isSimple(polygon: readonly LatLngPair[]): boolean {
  if (polygon.length < MIN_OUTLINE_CORNERS) return false
  if (new Set(polygon.map(([lat, lng]) => `${lat},${lng}`)).size !== polygon.length) return false
  const ring = edges(polygon.map(projector(polygon[0][0], polygon[0][1])))
  for (let i = 0; i < ring.length; i += 1) {
    for (let j = i + 1; j < ring.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === ring.length - 1)) continue
      if (segmentsCross(ring[i][0], ring[i][1], ring[j][0], ring[j][1])) return false
    }
  }
  return true
}

/** Same messages, same order of checks as the backend, or null when the outline is valid. */
export function validateOutline(polygon: readonly LatLngPair[], pin: LatLngPair | null): string | null {
  if (polygon.length < MIN_OUTLINE_CORNERS) return `An outline needs at least ${MIN_OUTLINE_CORNERS} corners.`
  if (polygon.length > MAX_OUTLINE_CORNERS) return `An outline may have at most ${MAX_OUTLINE_CORNERS} corners.`
  if (!isSimple(polygon)) return 'The outline crosses itself or repeats a corner.'
  const area = areaSquareMetres(polygon)
  if (area < MIN_OUTLINE_AREA_M2) return `The outline is too small (${Math.round(area)} m²); the minimum is ${MIN_OUTLINE_AREA_M2} m².`
  if (area > MAX_OUTLINE_AREA_M2) {
    return `The outline is too large (${(area / 1e6).toFixed(1)} km²); it may not exceed ${(MAX_OUTLINE_AREA_M2 / 1e6).toFixed(1)} km².`
  }
  if (pin !== null) {
    const outside = outsideByMetres(polygon, pin)
    if (outside > PIN_MAX_OUTSIDE_OUTLINE_METRES) {
      return `The pin is ${Math.round(outside)} m outside the outline; it must be inside it or within ${PIN_MAX_OUTSIDE_OUTLINE_METRES} m of its edge.`
    }
  }
  return null
}

/** A square of ±halfMetres around a point — the starting shape when OSM offers nothing. */
export function rectangleAround(lat: number, lng: number, halfMetres = STARTER_RECTANGLE_HALF_METRES): LatLngPair[] {
  const dLat = halfMetres / METRES_PER_DEGREE
  const dLng = halfMetres / (METRES_PER_DEGREE * Math.cos((lat * Math.PI) / 180))
  return [
    [lat + dLat, lng - dLng],
    [lat + dLat, lng + dLng],
    [lat - dLat, lng + dLng],
    [lat - dLat, lng - dLng],
  ]
}

/** Radius of the smallest circle about `centre` that holds every corner — used to frame
 *  maps and pick a thumbnail zoom exactly as a circle of that radius would. */
export function enclosingRadiusMetres(polygon: readonly LatLngPair[], centre: LatLngPair): number {
  const project = projector(centre[0], centre[1])
  return Math.max(...polygon.map((p) => Math.hypot(...project(p))))
}

/** "4 corners · 1.1 ha" — how an outline is named wherever a radius used to be printed. */
export function describeOutline(polygon: readonly LatLngPair[]): string {
  const area = areaSquareMetres(polygon)
  const size = area >= SQUARE_METRES_PER_HECTARE
    ? `${(area / SQUARE_METRES_PER_HECTARE).toFixed(1)} ha`
    : `${Math.round(area).toLocaleString('en-ZA')} m²`
  return `Outline · ${polygon.length} corners · ${size}`
}

/** How a precinct's fence reads in an info row: "200 m" for a circle, the outline summary
 *  otherwise — one wording on every surface that used to print only the radius. */
export function describeGeofence(precinct: {
  geofence_radius_metres: number
  geofence_polygon?: readonly LatLngPair[] | null
}): string {
  const outline = precinct.geofence_polygon
  return outline != null && outline.length >= MIN_OUTLINE_CORNERS
    ? describeOutline(outline)
    : `${precinct.geofence_radius_metres} m`
}
