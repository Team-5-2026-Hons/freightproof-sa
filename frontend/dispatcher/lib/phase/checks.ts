// The "Checked" zone's rows: every comparison a phase can be judged by, derived in one place
// from values the ledger already holds. Pure (no React, fetch or clock) so vitest can prove it.
//
// Consolidates logic that Loading/Unloading/Arrival/ConfirmationDetail each carry privately.
// Those panels keep their copies until Task 11 deletes them.
//
// Honesty rules that shape this module:
//  - Checks run only after a phase completes (D34). Before that the only rows are the live
//    scan counts, labelled "in progress", never pass or fail.
//  - A missing baseline is `not_checked`, never zero (null is not nothing was scanned).
//  - Location is TWO checks (D43): the truck against the precinct, and the driver against the
//    truck. They are never merged, so a passing truck cannot hide a separated driver.
//  - The anchor state is not an input anywhere here: anchoring is forensic detail.

import { countLabel } from '@/lib/format/count'
import type { PhaseDescriptor, SealCondition } from '@shared/lib/types/phase'
import type { Precinct } from '@shared/lib/types/precinct'
import { activePhase, departureSealForLeg, isResolved } from './derive'
import { locationEvidenceForPhase, VERDICT_LABELS, type LocationEvidence } from './location-evidence'

export type CheckKey =
  | 'truck_geofence'
  | 'driver_proximity'
  | 'parcels'
  | 'counts'
  | 'seal_number'
  | 'seal_condition'
  | 'seal_inspection'
  | 'bypassed'

export type CheckResult = 'pass' | 'flag' | 'not_checked' | 'in_progress'

export interface PhaseCheck {
  key: CheckKey
  result: CheckResult
  title: string
  detail: string
}

export interface PhaseChecksInput {
  phase: PhaseDescriptor
  allPhases: readonly PhaseDescriptor[]
  /** Loading: manifest total. Unloading: expected at this stop. Null when there is no baseline. */
  expectedCount: number | null
  /** The live warehouse scan for this stop. Used while a scan is running and, for unloading,
   *  after it (nothing stamps unloading, so its count stays live). Loading's resolved figure
   *  is the stamped `parcel_count_origin`, never this. */
  liveScannedCount: number | null
  /** Confirmation: parcels scanned out at the pickup stop. */
  originScannedCount: number | null
  precinct: Precinct | undefined
}

// All wording lives here so a copy change is one edit and a test can pin it. Titles double as
// the verdict's reasons, so each one must read on its own.
export const CHECK_WORDING = {
  bypassed: {
    title: 'Checks bypassed',
    detail: "A dispatcher closed this phase, so its checks did not run.",
  },
  truck: {
    passDetail: "The truck tracker's recorded position was inside the precinct boundary and tolerance.",
    flagDetail: "The truck tracker's recorded position was outside the precinct boundary and tolerance.",
    unavailableDetail: 'No precinct verdict was recorded for this phase.',
  },
  driver: {
    passTitle: 'Driver with truck',
    passDetail: "The driver's phone and the truck tracker were within the separation limit.",
    flagTitle: 'Driver separated from truck',
    flagDetail: "The driver's phone and the truck tracker were further apart than the separation limit.",
    unavailableTitle: 'Driver proximity unavailable',
    unavailableDetail: "The driver's phone and the truck tracker could not be compared.",
  },
  parcels: {
    passTitle: 'All parcels scanned',
    notCheckedTitle: 'Parcel count not checked',
    notCheckedDetail: 'No manifest baseline or scan count was recorded, so nothing was compared.',
    shortTitle: (n: number): string => `${countLabel(n, 'parcel')} not scanned`,
    excessTitle: (n: number): string => `${countLabel(n, 'excess parcel')} scanned`,
    figures: (expected: number, scanned: number): string => `${scanned} scanned of ${expected} expected`,
  },
  counts: {
    passTitle: 'Counts agree',
    notCheckedTitle: 'Parcel counts not compared',
    notCheckedDetail: 'The origin or destination scan count was not recorded, so nothing was compared.',
    shortTitle: (n: number): string => `${countLabel(n, 'parcel')} unaccounted for`,
    excessTitle: (n: number): string => `${countLabel(n, 'excess parcel')} scanned at destination`,
    figures: (origin: number, destination: number): string =>
      `${origin} scanned out at origin, ${destination} scanned in at destination`,
    // The driver's blind count is evidence in its own right, kept out of the verdict so its
    // independence is not spent. Task 9 renders this under Checked as static copy.
    blindCountNote: 'Counted blind: recorded as independent evidence, not reconciled against the scans above.',
  },
  liveScan: {
    title: 'Scan in progress',
    note: 'This count may still change.',
    direction: { loading: 'onto the truck', unloading: 'off the truck' },
  },
  sealNumber: {
    passTitle: 'Seal number matches departure',
    flagTitle: 'Seal number differs from departure',
    notCheckedTitle: 'Seal number not compared',
    noDepartureDetail: 'No departure seal was recorded for this leg, so there is nothing to compare.',
    noArrivalDetail: 'No seal number was read at arrival.',
    passDetail: (seal: string): string => `The seal found at arrival is the one recorded at departure (${seal}).`,
    flagDetail: (departure: string, arrival: string): string =>
      `Recorded ${departure} at departure and ${arrival} at arrival.`,
  },
  sealCondition: {
    notCheckedTitle: 'Seal condition not recorded',
    notCheckedDetail: 'No condition was recorded for the seal found at arrival.',
    passDetail: 'The seal was found intact at arrival.',
    flagDetail: 'The seal was not intact when found at arrival.',
    title: (condition: SealCondition): string => `Seal found ${condition}`,
  },
  sealInspection: {
    pendingTitle: 'Seal not inspected yet',
    resolvedTitle: 'Seal not inspected in transit',
    detail: (seal: string | null): string => {
      const first = 'The seal is first inspected at Arrival.'
      return seal === null ? first : `Sealed ${seal} at departure. ${first}`
    },
  },
} as const

const PARCELS_KEY = 'parcels'
const COUNTS_KEY = 'counts'

// ── Parcel comparisons ─────────────────────────────────────────────────────────

interface CountWording {
  passTitle: string
  notCheckedTitle: string
  notCheckedDetail: string
  shortTitle: (n: number) => string
  excessTitle: (n: number) => string
  figures: (baseline: number, actual: number) => string
}

/** `baseline - actual` > 0 is a shortfall, < 0 an excess. Null on either side is not_checked:
 *  no baseline means nothing to compare, not "nothing arrived". */
function compareCounts(
  key: 'parcels' | 'counts',
  wording: CountWording,
  baseline: number | null,
  actual: number | null,
): PhaseCheck {
  if (baseline === null || actual === null) {
    return { key, result: 'not_checked', title: wording.notCheckedTitle, detail: wording.notCheckedDetail }
  }
  const detail = wording.figures(baseline, actual)
  const gap = baseline - actual
  if (gap === 0) return { key, result: 'pass', title: wording.passTitle, detail }
  const title = gap > 0 ? wording.shortTitle(gap) : wording.excessTitle(Math.abs(gap))
  return { key, result: 'flag', title, detail }
}

function parcelsCheck(baseline: number | null, actual: number | null): PhaseCheck {
  return compareCounts(PARCELS_KEY, CHECK_WORDING.parcels, baseline, actual)
}

/** Live scan lines: the only thing an unresolved phase may show. A running count is an
 *  observation, not a verdict, so it is `in_progress` and never compared (D34).
 *  Only the plan's active phase gets one. The input carries no trip status, so on a
 *  cancelled trip the caller (Task 9) must not render this line for its unresolved phase. */
function liveScanChecks(input: PhaseChecksInput): PhaseCheck[] {
  const { phase, allPhases, expectedCount, liveScannedCount } = input
  if (phase.phase_type !== 'loading' && phase.phase_type !== 'unloading') return []
  if (liveScannedCount === null) return []
  if (activePhase(allPhases)?.phase_event_id !== phase.phase_event_id) return []
  const direction = CHECK_WORDING.liveScan.direction[phase.phase_type]
  const progress = expectedCount === null
    ? `${countLabel(liveScannedCount, 'parcel')} scanned ${direction} so far.`
    : `${liveScannedCount} of ${countLabel(expectedCount, 'parcel')} scanned ${direction} so far.`
  return [{
    key: PARCELS_KEY,
    result: 'in_progress',
    title: CHECK_WORDING.liveScan.title,
    detail: `${progress} ${CHECK_WORDING.liveScan.note}`,
  }]
}

// ── Location (D43): two checks, never merged ───────────────────────────────────

function truckGeofenceCheck(evidence: LocationEvidence): PhaseCheck {
  const { truck } = CHECK_WORDING
  switch (evidence.verdict) {
    case 'within_tolerance':
      return { key: 'truck_geofence', result: 'pass', title: VERDICT_LABELS.within_tolerance, detail: truck.passDetail }
    case 'outside_tolerance':
      return { key: 'truck_geofence', result: 'flag', title: VERDICT_LABELS.outside_tolerance, detail: truck.flagDetail }
    default:
      return { key: 'truck_geofence', result: 'not_checked', title: VERDICT_LABELS.not_verified, detail: truck.unavailableDetail }
  }
}

/** Only an assessment can state proximity. A legacy row that never recorded one gets no line
 *  at all, so older phases are not all marked unverified. */
function driverProximityCheck(evidence: LocationEvidence): PhaseCheck | null {
  if (!evidence.assessmentRecorded || !evidence.proximity) return null
  const { driver } = CHECK_WORDING
  switch (evidence.proximity) {
    case 'within_limit':
      return { key: 'driver_proximity', result: 'pass', title: driver.passTitle, detail: driver.passDetail }
    case 'separated':
      return { key: 'driver_proximity', result: 'flag', title: driver.flagTitle, detail: driver.flagDetail }
    case 'unverified':
      return { key: 'driver_proximity', result: 'not_checked', title: driver.unavailableTitle, detail: driver.unavailableDetail }
  }
}

function locationChecks(input: PhaseChecksInput): PhaseCheck[] {
  const evidence = locationEvidenceForPhase(input.phase, input.precinct)
  const proximity = driverProximityCheck(evidence)
  return proximity === null ? [truckGeofenceCheck(evidence)] : [truckGeofenceCheck(evidence), proximity]
}

// ── Seal (arrival) ─────────────────────────────────────────────────────────────

function sealNumberCheck(departureSeal: string | null, arrivalSeal: string | null): PhaseCheck {
  const wording = CHECK_WORDING.sealNumber
  if (departureSeal === null) {
    return { key: 'seal_number', result: 'not_checked', title: wording.notCheckedTitle, detail: wording.noDepartureDetail }
  }
  if (arrivalSeal === null) {
    return { key: 'seal_number', result: 'not_checked', title: wording.notCheckedTitle, detail: wording.noArrivalDetail }
  }
  if (departureSeal === arrivalSeal) {
    return { key: 'seal_number', result: 'pass', title: wording.passTitle, detail: wording.passDetail(arrivalSeal) }
  }
  // Two recorded numbers that differ are a fact, whether or not the backend also raised an
  // exception (design note O8); flagging here is what makes it visible without one.
  return { key: 'seal_number', result: 'flag', title: wording.flagTitle, detail: wording.flagDetail(departureSeal, arrivalSeal) }
}

function sealConditionCheck(condition: SealCondition | null | undefined): PhaseCheck {
  const wording = CHECK_WORDING.sealCondition
  if (!condition) {
    return { key: 'seal_condition', result: 'not_checked', title: wording.notCheckedTitle, detail: wording.notCheckedDetail }
  }
  const intact = condition === 'intact'
  return {
    key: 'seal_condition',
    result: intact ? 'pass' : 'flag',
    title: wording.title(condition),
    detail: intact ? wording.passDetail : wording.flagDetail,
  }
}

function arrivalChecks(input: PhaseChecksInput): PhaseCheck[] {
  const { phase, allPhases } = input
  return [
    sealNumberCheck(departureSealForLeg(allPhases, phase), phase.seal_number),
    sealConditionCheck(phase.seal_condition),
    ...locationChecks(input),
  ]
}

// ── Phase types ────────────────────────────────────────────────────────────────

function bypassedChecks(): PhaseCheck[] {
  return [{ key: 'bypassed', result: 'not_checked', ...CHECK_WORDING.bypassed }]
}

/** The only line an in_transit leg carries: no on-road check can pass, because no record says
 *  which ran. The seal is first inspected at Arrival, so this is a standing note, not a result.
 *  Shown while the leg is happening and after, never for a leg that has not started.
 *  The input carries no trip status, so for an unresolved leg on a cancelled trip the caller
 *  (Task 9) must not render this line. */
function transitChecks(input: PhaseChecksInput): PhaseCheck[] {
  const { phase, allPhases } = input
  const resolved = isResolved(phase)
  const isActive = activePhase(allPhases)?.phase_event_id === phase.phase_event_id
  if (!resolved && !isActive) return []
  const wording = CHECK_WORDING.sealInspection
  return [{
    key: 'seal_inspection',
    result: 'not_checked',
    title: resolved ? wording.resolvedTitle : wording.pendingTitle,
    detail: wording.detail(departureSealForLeg(allPhases, phase)),
  }]
}

function resolvedChecks(input: PhaseChecksInput): PhaseCheck[] {
  const { phase, expectedCount, liveScannedCount, originScannedCount } = input
  switch (phase.phase_type) {
    case 'activation':
    case 'departure':
      return locationChecks(input)
    case 'loading':
      return [parcelsCheck(expectedCount, phase.parcel_count_origin), ...locationChecks(input)]
    case 'unloading':
      return [parcelsCheck(expectedCount, liveScannedCount), ...locationChecks(input)]
    case 'arrival':
      return arrivalChecks(input)
    case 'confirmation':
      return [
        compareCounts(COUNTS_KEY, CHECK_WORDING.counts, originScannedCount, phase.parcel_count_destination),
        ...locationChecks(input),
      ]
    default:
      return []
  }
}

/** The checks for one phase. Empty for an unresolved phase, except the live scan lines of a
 *  running Loading/Unloading and the standing in_transit seal line. */
export function buildPhaseChecks(input: PhaseChecksInput): PhaseCheck[] {
  const { phase } = input
  if (phase.phase_type === 'trip_creation') return []
  if (phase.status === 'overridden') return bypassedChecks()
  if (phase.phase_type === 'in_transit') return transitChecks(input)
  return isResolved(phase) ? resolvedChecks(input) : liveScanChecks(input)
}
