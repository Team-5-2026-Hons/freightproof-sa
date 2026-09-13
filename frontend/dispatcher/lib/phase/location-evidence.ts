// Location evidence: the pure model behind the "recorded location comparison" viewer,
// an on-demand, read-only comparison of the driver's phone fix against the horse
// tracker's fix at a recorded phase.
//
// Read-side only, on purpose. This never fetches a fresh tracker position and never
// re-derives a geofence verdict: the stored `pulsit_geofence_confirmed` is historical
// evidence, computed once by the backend at capture time, and the browser's job is to
// show it as stored, not to recompute a fresher-looking answer that the backend never
// actually reached.

import { haversineMetres, separationMetres, toCoords, type Coords } from './geo'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

export type FixSource = 'driver_phone' | 'horse_tracker'

export interface RecordedFix {
  source: FixSource
  label: string
  coords: Coords
  // ISO timestamp when known; null otherwise. Never zero, never a stand-in like
  // completed_at: null is "we don't have a time for this fix", not "now".
  capturedAt: string | null
  // Human sentence explaining what IS known when capturedAt is null, e.g. the
  // tracker fix has no timestamp of its own, only a guarantee about its relationship
  // to the driver's capture.
  captureNote: string | null
}

export type GeofenceVerdict =
  | 'within_tolerance'
  | 'outside_tolerance'
  | 'not_verified'
  | 'not_checked_yet'
  | 'no_verdict_for_phase'

export interface BoundaryReference {
  coords: Coords
  radiusMetres: number
  precinctName: string
  // Only ever 'current_reference_only' in v1: historical geofence geometry is not
  // stored, so the circle drawn is today's precinct boundary, not the boundary that
  // was actually in force when the fix was captured. Must always be labelled as such.
  provenance: 'current_reference_only'
}

export interface LocationEvidence {
  driverFix: RecordedFix | null
  trackerFix: RecordedFix | null
  // Haversine gap between the two fixes; null unless BOTH are usable. Never a zero
  // fallback: zero is a real (coincident-fix) measurement, distinct from "no
  // comparison possible".
  separationMetres: number | null
  verdict: GeofenceVerdict
  boundary: BoundaryReference | null
}

export const FIX_LABELS: Record<FixSource, string> = {
  driver_phone: 'Driver phone',
  horse_tracker: 'Horse tracker',
}

export const VERDICT_LABELS: Record<GeofenceVerdict, string> = {
  within_tolerance: 'Within accepted tolerance',
  outside_tolerance: 'Outside accepted tolerance',
  not_verified: 'Not verified',
  not_checked_yet: 'Not checked yet',
  no_verdict_for_phase: 'No geofence verdict is recorded for transit legs',
}

// The backend only ever persists a tracker fix that already passed its skew gate
// against driver_captured_at, and it does not store the tracker's own capture time.
// Inventing one here (or reusing completed_at, which dates the whole phase rather
// than either fix) would fabricate evidence that was never actually recorded.
export const TRACKER_CAPTURE_NOTE = 'Captured within the corroboration window of the driver capture'

export const BOUNDARY_REFERENCE_LABEL = 'Current precinct boundary (reference only)'

export const COMPARISON_UNAVAILABLE = 'Comparison unavailable'

// Statuses where a phase has not yet been evaluated, as opposed to one that ran its
// course without a verdict being stored.
const UNEVALUATED_STATUSES: readonly PhaseDescriptor['status'][] = ['pending', 'in_progress']

/** Both numbers must be finite and within real-world lat/lng range. `toCoords` handles
 *  the null/undefined narrowing; this adds the range check it deliberately leaves out. */
export function isValidCoords(lat: number | null | undefined, lng: number | null | undefined): boolean {
  const coords = toCoords(lat ?? null, lng ?? null)
  if (coords === null) return false
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return false
  return coords.lat >= -90 && coords.lat <= 90 && coords.lng >= -180 && coords.lng <= 180
}

/** Valid Coords for a lat/lng pair, or null: the single narrowing point both fix
 *  builders below share, so a fix is never built from coordinates isValidCoords
 *  rejected. */
function validCoords(lat: number | null, lng: number | null): Coords | null {
  return isValidCoords(lat, lng) ? toCoords(lat, lng) : null
}

function driverFixFor(phase: PhaseDescriptor): RecordedFix | null {
  const coords = validCoords(phase.driver_phone_lat, phase.driver_phone_lng)
  if (coords === null) return null
  return {
    source: 'driver_phone',
    label: FIX_LABELS.driver_phone,
    coords,
    capturedAt: phase.driver_captured_at ?? null,
    captureNote: null,
  }
}

function trackerFixFor(phase: PhaseDescriptor): RecordedFix | null {
  const coords = validCoords(phase.horse_gps_lat, phase.horse_gps_lng)
  if (coords === null) return null
  return {
    source: 'horse_tracker',
    label: FIX_LABELS.horse_tracker,
    coords,
    capturedAt: null,
    captureNote: TRACKER_CAPTURE_NOTE,
  }
}

/** The stored verdict, honoured as-is. A non-null `pulsit_geofence_confirmed` ALWAYS
 *  wins, even on an in_transit leg: the backend recorded a real check and that fact
 *  outranks our expectation that transit legs go unchecked. Only the null case (no
 *  verdict was stored) branches on phase type/status to explain WHY it's null. */
function verdictFor(phase: PhaseDescriptor): GeofenceVerdict {
  if (phase.pulsit_geofence_confirmed === true) return 'within_tolerance'
  if (phase.pulsit_geofence_confirmed === false) return 'outside_tolerance'
  if (phase.phase_type === 'in_transit') return 'no_verdict_for_phase'
  if (UNEVALUATED_STATUSES.includes(phase.status)) return 'not_checked_yet'
  return 'not_verified'
}

function boundaryFor(precinct: Precinct | undefined): BoundaryReference | null {
  if (precinct === undefined) return null
  return {
    coords: { lat: precinct.latitude, lng: precinct.longitude },
    radiusMetres: precinct.geofence_radius_metres,
    precinctName: precinct.name,
    provenance: 'current_reference_only',
  }
}

export function locationEvidenceForPhase(phase: PhaseDescriptor, precinct: Precinct | undefined): LocationEvidence {
  const driverFix = driverFixFor(phase)
  const trackerFix = trackerFixFor(phase)
  return {
    driverFix,
    trackerFix,
    separationMetres: separationMetres(driverFix?.coords ?? null, trackerFix?.coords ?? null),
    verdict: verdictFor(phase),
    boundary: boundaryFor(precinct),
  }
}

export function hasComparison(evidence: LocationEvidence): boolean {
  return evidence.driverFix !== null && evidence.trackerFix !== null
}

export function hasAnyFix(evidence: LocationEvidence): boolean {
  return evidence.driverFix !== null || evidence.trackerFix !== null
}

/** Whether a phase recorded anything location-shaped worth a section: a fix, or a stored verdict. */
export function hasLocationEvidence(evidence: LocationEvidence): boolean {
  return hasAnyFix(evidence) || evidence.verdict === 'within_tolerance' || evidence.verdict === 'outside_tolerance'
}

// ── Boundary framing helpers ─────────────────────────────────────────────────────
// Shared by LocationComparisonMap (its default 'fixes' frame) and
// LocationComparisonSchematic (the tile-failure fallback) so both surfaces make the SAME
// call about whether the boundary belongs in frame. Living here rather than in the map
// component is what lets the schematic reuse them without importing the map that, in
// turn, imports the schematic.

// A boundary farther than this from every recorded fix would force the default frame to
// zoom out past the point where the fixes themselves are readable (the case from the
// brief: a fix 1,400 km from its precinct opening the map on a view of the whole
// country). Past this distance the boundary is left out of the default frame; the map's
// Fixes/Precinct control lets the dispatcher still switch to it on request.
export const BOUNDARY_NEARBY_METRES = 5_000

/** Fixes with finite coordinates, in evidence order: the one definition of "a fix worth
 *  plotting" that comparisonBounds and boundaryDistanceMetres both read, instead of the
 *  same finite-coordinate guard living in two places. */
export function validFixCoords(evidence: LocationEvidence): Coords[] {
  const points: Coords[] = []
  if (evidence.driverFix && Number.isFinite(evidence.driverFix.coords.lat) && Number.isFinite(evidence.driverFix.coords.lng)) {
    points.push(evidence.driverFix.coords)
  }
  if (evidence.trackerFix && Number.isFinite(evidence.trackerFix.coords.lat) && Number.isFinite(evidence.trackerFix.coords.lng)) {
    points.push(evidence.trackerFix.coords)
  }
  return points
}

/** The boundary, only when every field needed to draw or measure it is a real, finite
 *  number; a malformed boundary is silently ignored by every consumer the same way. */
export function validBoundary(evidence: LocationEvidence): BoundaryReference | null {
  const boundary = evidence.boundary
  const isValid =
    boundary !== null &&
    Number.isFinite(boundary.coords.lat) &&
    Number.isFinite(boundary.coords.lng) &&
    Number.isFinite(boundary.radiusMetres) &&
    boundary.radiusMetres >= 0
  return isValid ? boundary : null
}

/**
 * Distance from the boundary centre to the NEAREST valid fix; null when there is no
 * (valid) boundary, or no (valid) fix to measure from. This is a plain reference
 * distance, never a geofence verdict: the stored verdict above is the only place a pass
 * or fail is ever decided.
 */
export function boundaryDistanceMetres(evidence: LocationEvidence): number | null {
  const boundary = validBoundary(evidence)
  if (boundary === null) return null

  const points = validFixCoords(evidence)
  if (points.length === 0) return null

  return Math.min(...points.map((point) => haversineMetres(point, boundary.coords)))
}

/** Whether the boundary is close enough to the recorded fixes to belong in the default
 *  frame alongside them. See BOUNDARY_NEARBY_METRES for why a far boundary is excluded
 *  rather than always included. */
export function boundaryIsNearby(evidence: LocationEvidence): boolean {
  const distance = boundaryDistanceMetres(evidence)
  return distance !== null && distance <= BOUNDARY_NEARBY_METRES
}

/**
 * The boundary as the default frame shows it: included when there are no fixes at all
 * (nothing "fixes-first" to prefer, so the boundary is the only thing to frame on) or when
 * it is nearby; left out when it is far from every fix. Both the map's 'fixes' frame and
 * the schematic fallback read this, so the fallback never fits a boundary the live map
 * would have left out.
 */
export function boundaryInDefaultFrame(evidence: LocationEvidence): BoundaryReference | null {
  const boundary = validBoundary(evidence)
  if (boundary === null) return null
  if (validFixCoords(evidence).length === 0) return boundary
  return boundaryIsNearby(evidence) ? boundary : null
}
