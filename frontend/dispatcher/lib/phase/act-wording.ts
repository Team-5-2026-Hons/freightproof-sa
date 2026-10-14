// Every sentence the "Recorded" rail and the "Checked" placeholder say, in one place so a
// copy change is one edit and a test can pin it. Pure (no React, fetch or clock).
//
// Honesty rules that shape the wording:
//  - Every time names its clock (D16): the phone's, or the server's.
//  - An expectation is never a claim that something is missing (D15).
//  - The receiver's artifact is the receiver's only when the server attributed it (D8); the
//    string "Ed25519" appears nowhere, because nothing signs that image (D36).

import { EVIDENCE_ROLE_NOUN } from '@shared/lib/constants/phase-meta'
import { fmtDateTime, fmtTime } from '@shared/lib/utils/datetime'
import type { PhaseType } from '@shared/lib/types/phase'
import { countLabel } from '@/lib/format/count'
import { CONFIRM_VERBS } from './verdict'
import {
  showsReceivedTime,
  type AbsentAct, type AnchorAct, type CompletionAct, type EvidenceAct, type ExpectedAct,
} from './acts'

/** Every time names the clock it came from (D16). Exported so the exception rows say it the same way. */
export const CLOCK_SOURCE_LABEL = { device: 'Driver’s phone', server: 'System recorded' } as const
export const DEVICE_CLOCK = '(driver’s phone)'
export const SERVER_CLOCK = '(system recorded)'

export interface RecordedTime {
  at: string | null
  source: keyof typeof CLOCK_SOURCE_LABEL | null
}

/** A missing capture time stays missing; it must never inherit the completion's time. */
export function evidenceTimes(act: EvidenceAct): RecordedTime[] {
  if (act.provenance === 'receiver' && act.role === 'pod_signature') return [{ at: act.receivedAt, source: act.receivedAt ? 'server' : null }]
  if (!act.metadataAvailable || act.takenAt === null) return [{ at: null, source: null }]
  return [
    { at: act.takenAt, source: 'device' },
    ...(act.receivedAt && showsReceivedTime(act.takenAt, act.receivedAt) ? [{ at: act.receivedAt, source: 'server' } as const] : []),
  ]
}

export function completionTimes(act: CompletionAct): RecordedTime[] {
  if (act.confirmedAt === null) return [{ at: act.recordedAt, source: 'server' }]
  return [
    { at: act.confirmedAt, source: 'device' },
    ...(showsReceivedTime(act.confirmedAt, act.recordedAt) ? [{ at: act.recordedAt, source: 'server' } as const] : []),
  ]
}
const TIME_UNAVAILABLE = 'Time unavailable'
const NO_SEAL_RECORDED = 'No seal number recorded'

const STATE_WORDING: Record<EvidenceAct['state'], string> = {
  uploaded: 'Uploaded',
  submitted: 'Submitted at completion',
  not_submitted: 'Not submitted',
  after_close: 'Received after the phase closed',
  trip_cancelled: 'Not submitted — trip cancelled',
}
const AFTER_CANCELLATION = 'Received after the trip was cancelled'

// ── Evidence rows ────────────────────────────────────────────────────────────

const RECEIVER_CONFIRMED = 'Receiver confirmed delivery · Attestation image'
const RECEIVER_SUBMITTED = 'Submitted as receiver confirmation'

/** The act's headline. The receiver's confirmation is named as such only for an artifact
 *  the server attributed to the receiver; anything else in that field is "submitted as". */
export function evidenceTitle(act: EvidenceAct, phaseType: PhaseType): string {
  switch (act.role) {
    case 'linehaul_photo': return 'Linehaul sheet photographed'
    case 'seal_photo': return phaseType === 'arrival' ? 'Seal photographed on arrival' : 'Seal photographed'
    case 'waybill_photo': return 'Waybill copy photographed'
    case 'pod_photo': return 'Proof-of-delivery photo taken'
    case 'pod_signature': return act.provenance === 'receiver' ? RECEIVER_CONFIRMED : RECEIVER_SUBMITTED
  }
}

/** D24: capture order never decides what was submitted, so the state comes from the act. */
export function evidenceStateLabel(act: EvidenceAct): string {
  if (act.state === 'trip_cancelled' && act.receivedAfterCancellation) return AFTER_CANCELLATION
  return STATE_WORDING[act.state]
}

/** D16: "Taken" is the phone's clock, "Received" the server's, shown only when they differ
 *  enough to matter. The receiver's confirmation has no device clock worth trusting. */
export function evidenceTimeLines(act: EvidenceAct): string[] {
  if (act.provenance === 'receiver' && act.role === 'pod_signature') {
    return [act.receivedAt === null ? TIME_UNAVAILABLE : `Confirmed ${fmtDateTime(act.receivedAt)} ${SERVER_CLOCK}`]
  }
  if (!act.metadataAvailable || act.takenAt === null) return [TIME_UNAVAILABLE]
  const lines = [`Taken ${fmtDateTime(act.takenAt)} ${DEVICE_CLOCK}`]
  if (act.receivedAt !== null && showsReceivedTime(act.takenAt, act.receivedAt)) {
    lines.push(`Received ${fmtDateTime(act.receivedAt)} ${SERVER_CLOCK}`)
  }
  return lines
}

// ── Completion row ───────────────────────────────────────────────────────────

const OVERRIDE_TITLE = 'Closed by dispatcher override'
const EXCEPTION_SUFFIX = ' — exception recorded'

function completionBase(phaseType: PhaseType, stopName: string, destinationName: string): string {
  if (phaseType === 'activation') return `Driver confirmed arrival at ${stopName}`
  if (phaseType === 'in_transit') return `Reached ${destinationName}`
  return `Driver confirmed ${CONFIRM_VERBS[phaseType]}`
}

export function completionTitle(act: CompletionAct, phaseType: PhaseType, stopName: string, destinationName: string): string {
  if (act.outcome === 'overridden') return OVERRIDE_TITLE
  const base = completionBase(phaseType, stopName, destinationName)
  return act.outcome === 'exception' ? `${base}${EXCEPTION_SUFFIX}` : base
}

const SEAL_PHASES: readonly PhaseType[] = ['departure', 'arrival']

function sealLines(act: CompletionAct, phaseType: PhaseType): string[] {
  const { sealNumber, sealCondition } = act.values
  if (!SEAL_PHASES.includes(phaseType)) return []
  // A closed phase with no seal number is a recorded fact, but an override bypassed the
  // checks, so it never claims one (D35).
  if (sealNumber === null) return act.outcome === 'overridden' ? [] : [NO_SEAL_RECORDED]
  if (phaseType === 'departure') return [`Seal ${sealNumber}`]
  return [`Seal read ${sealNumber}`, ...(sealCondition ? [`Seal found ${sealCondition}`] : [])]
}

function countLines(act: CompletionAct, phaseType: PhaseType): string[] {
  const { parcelsScanned, driverVisualCount } = act.values
  const lines: string[] = []
  if (parcelsScanned !== null && phaseType === 'loading') lines.push(`${countLabel(parcelsScanned, 'parcel')} scanned onto truck`)
  if (parcelsScanned !== null && phaseType === 'confirmation') lines.push(`${countLabel(parcelsScanned, 'parcel')} scanned in at destination`)
  if (driverVisualCount !== null) lines.push(`Driver counted ${countLabel(driverVisualCount, 'parcel')}`)
  return lines
}

function overrideLines(act: CompletionAct): string[] {
  if (act.override === null) return []
  // The override record is visible to everyone: it is what happened, not audit plumbing (O3).
  // The id is shown as stored: the trip payload carries no user directory to resolve it against.
  return [
    ...(act.override.note ? [act.override.note] : []),
    ...(act.override.authorisedBy ? [`Authorised by ${act.override.authorisedBy}`] : []),
  ]
}

/** The recorded values and the override, as lines under the completion headline. */
export function completionValueLines(act: CompletionAct, phaseType: PhaseType): string[] {
  return [...sealLines(act, phaseType), ...countLines(act, phaseType), ...overrideLines(act)]
}

/** "Confirmed {device time} (device clock)", plus the server's recorded time when it differs. */
export function completionTimeLine(act: CompletionAct): string {
  const recorded = `${fmtDateTime(act.recordedAt)} ${SERVER_CLOCK}`
  if (act.confirmedAt === null) return `Recorded ${recorded}`
  const confirmed = `Confirmed ${fmtDateTime(act.confirmedAt)} ${DEVICE_CLOCK}`
  return showsReceivedTime(act.confirmedAt, act.recordedAt) ? `${confirmed} · recorded ${recorded}` : confirmed
}

// ── Absent, anchor, expected, awaiting ───────────────────────────────────────

/** D35: on a closed phase the absence of a submitted copy is a recorded fact. */
export function absentLabel(act: AbsentAct): string {
  return `No ${EVIDENCE_ROLE_NOUN[act.role]} submitted at completion`
}

export function anchorLabel(act: AnchorAct): string {
  if (act.status === 'pending') return 'Anchoring pending'
  if (act.status === 'failed') return 'Anchoring failed'
  return act.consensusAt === null ? 'Anchored' : `Anchored ${fmtDateTime(act.consensusAt)} (Hedera consensus)`
}

export function expectedLabel(act: ExpectedAct, phaseType: PhaseType, destinationName: string, expectedArrivalAt: string | null): string {
  switch (act.reason) {
    case 'evidence': return `Expected: ${act.role ? EVIDENCE_ROLE_NOUN[act.role] : 'evidence'}`
    case 'driver_confirmation': return `Waiting for the driver to confirm ${CONFIRM_VERBS[phaseType]}`
    case 'warehouse_scan': return 'Waiting for the warehouse scan to finish'
    case 'en_route': return expectedArrivalAt === null
      ? `En route to ${destinationName}`
      : `En route to ${destinationName} · expected ${fmtTime(expectedArrivalAt)}`
  }
}

/** The Checked placeholder before the driver confirms. */
export function checksAwaitingLabel(phaseType: PhaseType): string {
  return `Checks appear when the driver confirms ${CONFIRM_VERBS[phaseType]}`
}
