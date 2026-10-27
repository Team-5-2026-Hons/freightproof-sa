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
import type { LatLngPair, Precinct } from '@shared/lib/types/precinct'
import { MIN_OUTLINE_CORNERS, enclosingRadiusMetres } from '@/lib/map/polygon'
import type { ActionLocationAssessment, ProximityReason, ProximityVerdict } from '@shared/lib/types/action-location'

export type FixSource = 'driver_phone' | 'horse_tracker'

export interface RecordedFix {
  source: FixSource
  label: string
  coords: Coords
  capturedAt: string | null
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
  polygon?: LatLngPair[] | null
  precinctName: string
  provenance: 'recorded_snapshot' | 'current_reference_only'
  policyVersion?: string
  toleranceMetres?: number
}

export interface LocationEvidence {
  driverFix: RecordedFix | null
  trackerFix: RecordedFix | null
  separationMetres: number | null
  proximity?: ProximityVerdict | null
  proximityReasons?: readonly string[]
  assessmentRecorded?: boolean
  verdict: GeofenceVerdict
  boundary: BoundaryReference | null
}

export const FIX_LABELS: Record<FixSource, string> = {
  driver_phone: 'Driver phone',
  horse_tracker: 'Horse tracker',
}

export const VERDICT_LABELS: Record<GeofenceVerdict, string> = {
  within_tolerance: 'Truck within precinct tolerance',
  outside_tolerance: 'Truck outside precinct tolerance',
  not_verified: 'Truck precinct check unavailable',
  not_checked_yet: 'Truck precinct check unavailable',
  no_verdict_for_phase: 'Truck precinct check unavailable for transit legs',
}

export const PROXIMITY_LABELS: Record<ProximityVerdict, string> = {
  within_limit: 'Within limit',
  separated: 'Outside limit',
  unverified: 'Unable to compare',
}

export const PROXIMITY_REASON_LABELS: Record<ProximityReason, string> = {
  missing_phone: 'the driver’s phone location was not available',
  missing_tracker: 'the truck tracker location was not available',
  missing_time: 'a capture time was missing',
  missing_accuracy: 'the phone did not report how accurate its location was',
  poor_accuracy: 'the phone location was too imprecise',
  stale_fix: 'a location reading was too old',
  time_skew: 'the phone and tracker readings were too far apart in time',
  future_fix: 'a location reading was dated in the future',
}

export const TRACKER_CAPTURE_NOTE = 'Captured within the corroboration window of the driver capture'

export const BOUNDARY_REFERENCE_LABEL = 'Current precinct boundary (reference only)'

export const COMPARISON_UNAVAILABLE = 'Comparison unavailable'

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

function driverFixFor(phase: PhaseDescriptor | null, assessment: ActionLocationAssessment | null): RecordedFix | null {
  const coords = assessment
    ? validCoords(assessment.driver_lat, assessment.driver_lng)
    : phase ? validCoords(phase.driver_phone_lat, phase.driver_phone_lng) : null
  if (coords === null) return null
  return {
    source: 'driver_phone',
    label: FIX_LABELS.driver_phone,
    coords,
    capturedAt: assessment ? assessment.driver_captured_at : phase?.driver_captured_at ?? null,
    captureNote: null,
  }
}

function trackerFixFor(phase: PhaseDescriptor | null, assessment: ActionLocationAssessment | null): RecordedFix | null {
  const coords = assessment
    ? validCoords(assessment.tracker_lat, assessment.tracker_lng)
    : phase ? validCoords(phase.horse_gps_lat, phase.horse_gps_lng) : null
  if (coords === null) return null
  return {
    source: 'horse_tracker',
    label: FIX_LABELS.horse_tracker,
    coords,
    capturedAt: assessment?.tracker_captured_at ?? null,
    captureNote: assessment?.tracker_captured_at ? null : TRACKER_CAPTURE_NOTE,
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

function usableOutline(polygon: LatLngPair[] | null | undefined): LatLngPair[] | null {
  return polygon != null && polygon.length >= MIN_OUTLINE_CORNERS ? polygon : null
}

function boundaryFor(precinct: Precinct | undefined, assessment: ActionLocationAssessment | null): BoundaryReference | null {
  if (assessment === null) {
    if (precinct === undefined) return null
    const outline = usableOutline(precinct.geofence_polygon)
    return {
      coords: { lat: precinct.latitude, lng: precinct.longitude },
      radiusMetres: outline
        ? enclosingRadiusMetres(outline, [precinct.latitude, precinct.longitude])
        : precinct.geofence_radius_metres,
      ...(outline !== null ? { polygon: outline } : {}),
      precinctName: precinct.name,
      provenance: 'current_reference_only',
    }
  }
  const recordedCoords = validCoords(assessment?.precinct_lat ?? null, assessment?.precinct_lng ?? null)
  const recordedOutline = usableOutline(assessment.precinct_geofence_polygon)
  if (recordedCoords && recordedOutline) {
    return {
      coords: recordedCoords,
      radiusMetres: enclosingRadiusMetres(recordedOutline, [recordedCoords.lat, recordedCoords.lng]),
      polygon: recordedOutline,
      precinctName: precinct?.name ?? 'Recorded precinct',
      provenance: 'recorded_snapshot',
      policyVersion: assessment.policy_version,
      toleranceMetres: assessment.precinct_tolerance_metres ?? undefined,
    }
  }
  if (recordedCoords && assessment.precinct_radius_metres !== null) {
    return {
      coords: recordedCoords,
      radiusMetres: assessment.precinct_radius_metres,
      precinctName: precinct?.name ?? 'Recorded precinct',
      provenance: 'recorded_snapshot',
      policyVersion: assessment.policy_version,
      toleranceMetres: assessment.precinct_tolerance_metres ?? undefined,
    }
  }
  return null
}

function buildEvidence(
  phase: PhaseDescriptor | null,
  assessment: ActionLocationAssessment | null,
  precinct: Precinct | undefined,
  verdict: GeofenceVerdict,
): LocationEvidence {
  const driverFix = driverFixFor(phase, assessment)
  const trackerFix = trackerFixFor(phase, assessment)
  return {
    driverFix,
    trackerFix,
    separationMetres: assessment ? assessment.separation_metres : separationMetres(driverFix?.coords ?? null, trackerFix?.coords ?? null),
    proximity: assessment?.proximity ?? null,
    proximityReasons: assessment?.reasons ?? [],
    assessmentRecorded: assessment !== null,
    verdict,
    boundary: boundaryFor(precinct, assessment),
  }
}

export function locationEvidenceForPhase(phase: PhaseDescriptor, precinct: Precinct | undefined): LocationEvidence {
  return buildEvidence(phase, phase.action_location_assessment ?? null, precinct, verdictFor(phase))
}

/** Evidence for a snapshot that belongs to a record OTHER than a phase — a driver's
 *  exception report or a checkpoint carries its own capture-time comparison. There is
 *  no phase geofence verdict to honour for such a capture, so the verdict is the plain
 *  "unavailable" one, never a transit-leg or not-yet-checked explanation that would
 *  describe a phase this capture is not. */
export function locationEvidenceForAssessment(assessment: ActionLocationAssessment, precinct: Precinct | undefined): LocationEvidence {
  return buildEvidence(null, assessment, precinct, 'not_verified')
}

export function hasComparison(evidence: LocationEvidence): boolean {
  return evidence.driverFix !== null && evidence.trackerFix !== null
}

export function hasAnyFix(evidence: LocationEvidence): boolean {
  return evidence.driverFix !== null || evidence.trackerFix !== null
}

/** Whether a phase recorded anything location-shaped worth a section: a fix, or a stored verdict. */
export function hasLocationEvidence(evidence: LocationEvidence): boolean {
  return hasAnyFix(evidence) || evidence.proximity !== null || evidence.verdict === 'within_tolerance' || evidence.verdict === 'outside_tolerance'
}

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
