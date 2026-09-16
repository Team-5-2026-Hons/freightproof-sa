// Location evidence: the pure model behind the "recorded location comparison" viewer,
// comparing the driver's phone fix against the horse tracker's fix at a recorded phase.
// Read-side only: never fetches a fresh tracker position or re-derives a geofence
// verdict — `pulsit_geofence_confirmed` is historical evidence computed once by the
// backend, shown as stored, not recomputed.

import { haversineMetres, separationMetres, toCoords, type Coords } from './geo'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'

export type FixSource = 'driver_phone' | 'horse_tracker'

export interface RecordedFix {
  source: FixSource
  label: string
  coords: Coords
  // ISO timestamp when known; null means "no time for this fix", never "now".
  capturedAt: string | null
  /** Explains what IS known when capturedAt is null. */
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
  // Historical geofence geometry isn't stored, so this is always today's boundary,
  // never the one actually in force when the fix was captured.
  provenance: 'current_reference_only'
}

export interface LocationEvidence {
  driverFix: RecordedFix | null
  trackerFix: RecordedFix | null
  // Haversine gap between the two fixes; null unless BOTH are usable (zero is a real
  // coincident-fix measurement, distinct from "no comparison possible").
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

// The backend doesn't store the tracker's own capture time; inventing one (or reusing
// completed_at, which dates the whole phase) would fabricate evidence never recorded.
export const TRACKER_CAPTURE_NOTE = 'Captured within the corroboration window of the driver capture'

export const BOUNDARY_REFERENCE_LABEL = 'Current precinct boundary (reference only)'

export const COMPARISON_UNAVAILABLE = 'Comparison unavailable'

// Statuses where a phase hasn't yet been evaluated, vs. one that ran its course with no verdict stored.
const UNEVALUATED_STATUSES: readonly PhaseDescriptor['status'][] = ['pending', 'in_progress']

/** Both numbers finite and within real-world lat/lng range; `toCoords` only does
 *  null/undefined narrowing. */
export function isValidCoords(lat: number | null | undefined, lng: number | null | undefined): boolean {
  const coords = toCoords(lat ?? null, lng ?? null)
  if (coords === null) return false
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return false
  return coords.lat >= -90 && coords.lat <= 90 && coords.lng >= -180 && coords.lng <= 180
}

/** Valid Coords for a lat/lng pair, or null — the single narrowing point both fix builders share. */
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
 *  wins, even on an in_transit leg. Only the null case branches on phase type/status to
 *  explain WHY it's null. */
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

// Boundary framing helpers, shared by LocationComparisonMap's default 'fixes' frame and
// the LocationComparisonSchematic fallback, so both make the same call on whether the
// boundary belongs in frame.

// Past this distance from every recorded fix, the default frame would zoom out too far
// for the fixes to be readable, so the boundary is left out (the Fixes/Precinct control
// still lets the dispatcher switch to it).
export const BOUNDARY_NEARBY_METRES = 5_000

/** Fixes with finite coordinates, in evidence order — the one definition of "worth
 *  plotting" shared by comparisonBounds and boundaryDistanceMetres. */
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

/** The boundary, only when every field needed to draw/measure it is a real, finite number. */
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

/** Distance from the boundary centre to the NEAREST valid fix; null with no valid
 *  boundary or fix. A plain reference distance, never a geofence verdict. */
export function boundaryDistanceMetres(evidence: LocationEvidence): number | null {
  const boundary = validBoundary(evidence)
  if (boundary === null) return null

  const points = validFixCoords(evidence)
  if (points.length === 0) return null

  return Math.min(...points.map((point) => haversineMetres(point, boundary.coords)))
}

/** Whether the boundary is close enough to the recorded fixes to belong in the default
 *  frame. See BOUNDARY_NEARBY_METRES. */
export function boundaryIsNearby(evidence: LocationEvidence): boolean {
  const distance = boundaryDistanceMetres(evidence)
  return distance !== null && distance <= BOUNDARY_NEARBY_METRES
}

/** The boundary as the default frame shows it: included when there are no fixes at all,
 *  or when it's nearby; left out when far from every fix. Shared by the map's 'fixes'
 *  frame and the schematic fallback. */
export function boundaryInDefaultFrame(evidence: LocationEvidence): BoundaryReference | null {
  const boundary = validBoundary(evidence)
  if (boundary === null) return null
  if (validFixCoords(evidence).length === 0) return boundary
  return boundaryIsNearby(evidence) ? boundary : null
}
