// On-device ETA from the planned route. Pure: no React, no fetch, no clock reads —
// `now` is passed in so every branch is testable.
//
// POPIA: this runs on the phone so the driver's live position never has to leave it.
// The server only ever routes between precincts (business locations).
//
// The method, in the order a reader would check it:
//   1. Snap the fix to the nearest point on the current leg's line.
//   2. Fraction covered = line length up to that point / whole line length.
//   3. Planned time left = leg duration × (1 − fraction covered).
//   4. Pace = how long the truck has actually taken for the part it has covered,
//      divided by how long the plan said that part would take. Applied to the time left.
// No live traffic: the plan is a truck's free-flow time, and pace is what corrects it.

import type { DriverPosition } from '@/lib/types/location'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { RouteCoordinate, TripRoute, TripRouteLeg } from '@/lib/types/route'

const EARTH_RADIUS_METRES = 6_371_000

export const OFF_ROUTE_METRES = 500

export const MIN_PACE_SAMPLE_SECONDS = 15 * 60

export const PACE_MIN = 0.8
export const PACE_MAX = 2

export type RouteEstimate =
  | {
      kind: 'on_route'
      arrivalAt: Date
      remainingMetres: number
      pace: number
    }
  | { kind: 'off_route'; offRouteMetres: number }

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function haversineMetres(a: RouteCoordinate, b: RouteCoordinate): number {
  const dLat = toRadians(b[0] - a[0])
  const dLng = toRadians(b[1] - a[1])
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a[0])) * Math.cos(toRadians(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Where on segment a→b the point p falls (t in [0, 1]) and how far p is from it.
 * Flat-earth projection around `a`: route segments are tens of metres long, where the
 * error is far below GPS noise.
 */
function projectOntoSegment(
  p: RouteCoordinate,
  a: RouteCoordinate,
  b: RouteCoordinate,
): { t: number; distanceMetres: number } {
  const metresPerDegLat = (Math.PI * EARTH_RADIUS_METRES) / 180
  const metresPerDegLng = metresPerDegLat * Math.cos(toRadians(a[0]))
  const bx = (b[1] - a[1]) * metresPerDegLng
  const by = (b[0] - a[0]) * metresPerDegLat
  const px = (p[1] - a[1]) * metresPerDegLng
  const py = (p[0] - a[0]) * metresPerDegLat
  const lengthSquared = bx * bx + by * by
  const t = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, (px * bx + py * by) / lengthSquared))
  return { t, distanceMetres: Math.hypot(px - t * bx, py - t * by) }
}

/** The leg an in_transit row is driving: the one leaving the stop it is anchored to. */
export function legForPhase(route: TripRoute | null, phase: PhaseDescriptor | null): TripRouteLeg | null {
  if (route === null || phase === null || phase.phase_type !== 'in_transit' || phase.stop_sequence === null) {
    return null
  }
  return route.legs.find((leg) => leg.from_stop_sequence === phase.stop_sequence) ?? null
}

/** How far along `leg` a position is (0–1), and how far off the line it sits. */
export function progressAlongLeg(
  leg: TripRouteLeg,
  position: Pick<DriverPosition, 'lat' | 'lng'>,
): { fraction: number; offRouteMetres: number } | null {
  const line = leg.coordinates
  if (line.length < 2) return null

  const p: RouteCoordinate = [position.lat, position.lng]
  let total = 0
  let best = { distanceMetres: Infinity, along: 0 }

  for (let i = 0; i < line.length - 1; i += 1) {
    const segmentLength = haversineMetres(line[i], line[i + 1])
    const { t, distanceMetres } = projectOntoSegment(p, line[i], line[i + 1])
    if (distanceMetres < best.distanceMetres) {
      best = { distanceMetres, along: total + t * segmentLength }
    }
    total += segmentLength
  }

  if (total === 0) return null
  return { fraction: best.along / total, offRouteMetres: best.distanceMetres }
}

/**
 * The ETA for the leg being driven.
 *
 * `departedAt` is trip.actual_departure_at, which the backend rewrites at every departure,
 * so it always marks the start of the CURRENT leg. null = pace unknown, plan speed used.
 */
export function estimateArrival({
  leg,
  position,
  departedAt,
  now,
}: {
  leg: TripRouteLeg
  position: DriverPosition
  departedAt: string | null
  now: Date
}): RouteEstimate | null {
  const progress = progressAlongLeg(leg, position)
  if (progress === null) return null

  const tolerance = OFF_ROUTE_METRES + (position.accuracyM ?? 0)
  if (progress.offRouteMetres > tolerance) {
    return { kind: 'off_route', offRouteMetres: progress.offRouteMetres }
  }

  const plannedElapsedSeconds = leg.duration_seconds * progress.fraction
  let pace = 1
  if (departedAt !== null && plannedElapsedSeconds >= MIN_PACE_SAMPLE_SECONDS) {
    const actualElapsedSeconds = (now.getTime() - new Date(departedAt).getTime()) / 1000
    if (actualElapsedSeconds > 0) {
      pace = Math.min(PACE_MAX, Math.max(PACE_MIN, actualElapsedSeconds / plannedElapsedSeconds))
    }
  }

  const remainingSeconds = leg.duration_seconds * (1 - progress.fraction) * pace
  return {
    kind: 'on_route',
    arrivalAt: new Date(now.getTime() + remainingSeconds * 1000),
    remainingMetres: leg.distance_metres * (1 - progress.fraction),
    pace,
  }
}
