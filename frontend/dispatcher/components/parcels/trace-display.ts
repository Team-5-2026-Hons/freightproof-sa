import { createElement, type ComponentPropsWithoutRef, type ReactElement } from 'react'
import { PHASE_NAMES } from '@shared/lib/constants/phase-meta'
import { EXCEPTION_SEVERITY_META, TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import type { ExceptionSeverity } from '@shared/lib/types/exception'
import type { ParcelJourney, ParcelProgress, ParcelScanObservation, ParcelSealWindow, ParcelTraceException, ParcelTracePhase } from '@shared/lib/types/parcel-trace'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { ChipType } from '@/components/ui/Chip'
import { ROUTES } from '@/lib/constants/routes'
import { countLabel } from '@/lib/format/count'
import { fmtExceptionType } from '@/lib/format/exception'
import { withReturnTo } from '@/lib/navigation/returnTo'

export const BARCODE_MAX_LENGTH = 100

export type HeadingLevel = 3 | 4 | 5 | 6
export function Heading({ level, ...props }: { level: HeadingLevel } & ComponentPropsWithoutRef<'h3'>): ReactElement {
  return createElement(`h${level}`, props)
}

export const LOCATION_LABELS: Record<ParcelTracePhase['location_verdict'], string> = {
  confirmed: 'Truck within precinct tolerance',
  mismatch: 'Truck outside precinct tolerance',
  unwitnessed: 'No recorded tracker confirmation',
  not_recorded: 'Location not recorded for this step',
}

export const RELEVANCE_LABELS: Record<ParcelTracePhase['relevance'], string> = {
  consignment: 'This consignment',
  trip_context: 'Other trip context',
  unknown: 'Relevance unknown',
}

export const EXCEPTION_SCOPE_LABELS: Record<ParcelTraceException['scope'], string> = {
  consignment: RELEVANCE_LABELS.consignment,
  trip_context: 'Whole trip',
}

const NEEDS_REVIEW_STATUS = 'needs_review'
const REVIEW_STATUS_LABELS: Record<string, string> = { recorded: 'Recorded', [NEEDS_REVIEW_STATUS]: 'Needs review', reviewed: 'Reviewed' }

/** The DTO types review_status as a free string, so an unexpected value is shown as recorded rather than guessed at. */
export function reviewStatusLabel(status: string): string {
  return REVIEW_STATUS_LABELS[status] ?? status
}

/** The DTO types severity as a free string, so an unexpected value is shown as it arrives rather than guessed at. */
export function severityLabel(severity: string): string {
  return Object.hasOwn(EXCEPTION_SEVERITY_META, severity) ? EXCEPTION_SEVERITY_META[severity as ExceptionSeverity].label : severity
}

export function awaitsReview(exception: ParcelTraceException): boolean {
  return exception.review_status === NEEDS_REVIEW_STATUS
}

export function progressChipType(progress: ParcelProgress): ChipType {
  if (progress.has_overrides) return 'exception'
  return progress.position === 'after_delivery' ? 'complete' : 'transit'
}

export function progressLabel(progress: ParcelProgress, phases: readonly ParcelTracePhase[] = []): string {
  if (progress.position === 'cancelled') return 'Journey cancelled'
  if (progress.position === 'unknown') return 'Consignment progress unavailable'
  if (progress.position === 'before_pickup') return 'Awaiting pickup'
  if (progress.position === 'after_delivery') return progress.has_overrides ? 'Journey resolved with an override' : 'Delivery phase recorded'
  const current = phases.find(phase => phase.id === progress.phase_event_id)
  if (current?.relevance === 'trip_context') return 'At an intermediate stop (other cargo handling)'
  if (progress.phase_type === 'in_transit') return 'In transit, awaiting arrival attestation'
  const name = progress.phase_type ? PHASE_NAMES[progress.phase_type] : 'Next phase'
  return progress.phase_status === 'in_progress' ? `${name} in progress` : `Awaiting ${name.toLowerCase()}`
}

export function tripEvidenceLink(tripId: string, returnTo: string, phaseId?: string): string {
  const target = withReturnTo(ROUTES.tripDetail(tripId), returnTo)
  return phaseId ? `${target}#phase-${encodeURIComponent(phaseId)}` : target
}

export function locationLabel(journey: ParcelJourney): string {
  const fix = journey.last_recorded_location
  if (!fix) return 'No recorded position within this consignment’s journey'
  if (fix.precinct_confirmed === true && fix.precinct_name) return `Vehicle recorded at ${fix.precinct_name}`
  if (fix.precinct_confirmed === false && fix.precinct_name) return `Vehicle recorded outside ${fix.precinct_name} tolerance`
  return 'Position recorded, facility unverified'
}

const RECORDED_PHASE_STATUSES: readonly ParcelTracePhase['status'][] = ['completed', 'exception', 'overridden']

function isRecorded(phase: ParcelTracePhase): boolean {
  return RECORDED_PHASE_STATUSES.includes(phase.status)
}

/**
 * The last phase in ledger order that is recorded AND concerns this consignment. Ledger order, never timestamp:
 * the ledger is the truth for sequence, and device clocks can disagree with it.
 */
export function lastRecordedPhase(journey: ParcelJourney): ParcelTracePhase | null {
  return journey.phases.findLast(phase => phase.relevance === 'consignment' && isRecorded(phase)) ?? null
}

/**
 * The sealed leg that answers "in which custody stretch was this last recorded". The window containing the last
 * recorded phase; failing that, the last window (in ledger order) whose departure phase is recorded; else none.
 */
export function relevantSealWindow(journey: ParcelJourney): ParcelSealWindow | null {
  const last = lastRecordedPhase(journey)
  const containing = last ? journey.seal_windows.find(window => window.phase_ids.includes(last.id)) : undefined
  if (containing) return containing
  const ledgerIndex = new Map(journey.phases.map((phase, index) => [phase.id, index]))
  const recordedDepartures = journey.seal_windows
    .filter(window => { const departure = journey.phases[ledgerIndex.get(window.departure_phase_id) ?? -1]; return departure !== undefined && isRecorded(departure) })
    .sort((a, b) => (ledgerIndex.get(a.departure_phase_id) ?? 0) - (ledgerIndex.get(b.departure_phase_id) ?? 0))
  return recordedDepartures.at(-1) ?? null
}

/** "2 exceptions · 1 needs review". Wording shared with the trip exception rows; only needs_review awaits review. */
export function exceptionCountLabel(items: readonly ParcelTraceException[]): string {
  const waiting = items.filter(awaitsReview).length
  return `${countLabel(items.length, 'exception')}${waiting === 0 ? '' : ` · ${waiting} ${waiting === 1 ? 'needs' : 'need'} review`}`
}

export interface ExceptionTypeGroup {
  type: string
  label: string
  count: number
  needsReview: number
  summary: string
}

/** Groups by exception_type in first-seen order. Never by description, so repeated wording stays one honest count. */
export function exceptionTypeGroups(items: readonly ParcelTraceException[]): ExceptionTypeGroup[] {
  const byType = new Map<string, ParcelTraceException[]>()
  for (const item of items) byType.set(item.exception_type, [...(byType.get(item.exception_type) ?? []), item])
  return [...byType].map(([type, members]) => {
    const label = fmtExceptionType(type)
    const needsReview = members.filter(awaitsReview).length
    const review = needsReview === 0 ? '' : ` · ${needsReview} ${needsReview === 1 ? 'needs' : 'need'} review`
    return { type, label, count: members.length, needsReview, summary: `${label} ×${members.length}${review}` }
  })
}

function scanOutText(scans: readonly ParcelScanObservation[], lead: string, none: string): string {
  const times = scans.map(scan => scan.scan_out_at).filter((time): time is string => time !== null)
  if (times.length === 0) return none
  const earliest = [...times].sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0]
  return new Set(times).size === 1
    ? `${lead} ${fmtDateTime(earliest)}`
    : `${lead} on ${countLabel(times.length, 'parcel record')}, earliest ${fmtDateTime(earliest)}`
}

/** One line for an earlier-association row. Distinguishes "no record retained" from "a record with no scan-out". */
export function scanSummary(scans: readonly ParcelScanObservation[]): string {
  return scans.length === 0 ? 'No retained scan record' : scanOutText(scans, 'Scan-out', 'No scan-out recorded')
}

const TIME_NOT_RECORDED = 'Time not recorded'
const TRIP_WIDE_RECORD = 'Trip-wide record'
const NO_RECORDED_STEP = 'No recorded step for this parcel yet.'
const SCAN_SOURCE_TEXT = 'parcel scan'
const SCAN_OUT_TITLE = 'Scanned out at origin'
const SCAN_IN_TITLE = 'Scanned in at destination'
const OVERRIDDEN_SUFFIX = ' (overridden)'
const UNRECORDED_PLACE = 'an unrecorded place'
const ORIGIN_SCAN_ITEM = 'origin scan-out'
const SEAL_CHECK_ITEM = 'seal check'
export const DESTINATION_SCAN_ITEM = 'destination scan'
const FLAGGED_LOCATION_VERDICTS: readonly ParcelTracePhase['location_verdict'][] = ['mismatch', 'unwitnessed']
const OPEN_SEAL_STATUSES: readonly ParcelSealWindow['status'][] = ['pending', 'unverified']

export interface ParcelStep {
  kind: 'scan-out' | 'phase' | 'cancelled' | 'scan-in'
  key: string
  title: string
  subline: string
  sentence: string
  marker: 'recorded' | 'in_progress' | 'warn'
  phase: ParcelTracePhase | null
  scan: ParcelScanObservation | null
  exceptions: ParcelTraceException[]
  issuePill: string | null
  overridden: boolean
  relevanceUnknown: boolean
}

function lowerPhaseName(phase: ParcelTracePhase): string {
  return PHASE_NAMES[phase.phase_type].toLowerCase()
}

function phaseWording(phase: ParcelTracePhase, journey: ParcelJourney): { title: string; sentence: string } {
  const place = phase.precinct_name
  const at = place ? ` at ${place}` : ''
  if (phase.status === 'in_progress') return { title: `${PHASE_NAMES[phase.phase_type]} in progress`, sentence: `${lowerPhaseName(phase)} in progress${at}` }
  switch (phase.phase_type) {
    case 'loading': return { title: 'Consignment loaded', sentence: `consignment loaded${at}` }
    case 'departure': {
      const seal = phase.seal_number ?? journey.seal_windows.find(window => window.phase_ids.includes(phase.id))?.departure_seal ?? null
      return { title: seal ? `Departed, sealed ${seal}` : 'Departed', sentence: `departed${place ? ` ${place}` : ''}${seal ? ` under seal ${seal}` : ''}` }
    }
    case 'in_transit': return { title: 'In transit recorded', sentence: 'in transit recorded' }
    case 'arrival': return place ? { title: `Arrived at ${place}`, sentence: `arrived at ${place}` } : { title: 'Arrival recorded', sentence: 'arrival recorded' }
    case 'unloading': return { title: 'Consignment unloaded', sentence: `consignment unloaded${at}` }
    case 'confirmation': return { title: 'Confirmation recorded', sentence: `confirmation recorded${at}` }
    default: return { title: `${PHASE_NAMES[phase.phase_type]} recorded`, sentence: `${lowerPhaseName(phase)} recorded${at}` }
  }
}

function isStepPhase(phase: ParcelTracePhase): boolean {
  if (phase.relevance === 'consignment') return isRecorded(phase) || phase.status === 'in_progress'
  return phase.relevance === 'unknown' && isRecorded(phase)
}

function issuePill(phase: ParcelTracePhase, exceptions: readonly ParcelTraceException[]): string | null {
  if (exceptions.length > 0) return exceptionCountLabel(exceptions)
  return FLAGGED_LOCATION_VERDICTS.includes(phase.location_verdict) ? LOCATION_LABELS[phase.location_verdict] : null
}

function phaseStep(phase: ParcelTracePhase, journey: ParcelJourney, exceptions: ParcelTraceException[]): ParcelStep {
  const wording = phaseWording(phase, journey)
  const overridden = phase.status === 'overridden'
  const subline = [
    phase.completed_at ? fmtDateTime(phase.completed_at) : TIME_NOT_RECORDED,
    phase.precinct_name ?? TRIP_WIDE_RECORD,
    phase.phase_type === 'loading' && journey.vehicle_registration ? `vehicle ${journey.vehicle_registration}` : null,
  ].filter(Boolean).join(' · ')
  return {
    kind: 'phase', key: phase.id, subline,
    title: `${wording.title}${overridden ? OVERRIDDEN_SUFFIX : ''}`,
    sentence: `${wording.sentence}${overridden ? OVERRIDDEN_SUFFIX : ''}`,
    marker: phase.status === 'in_progress' ? 'in_progress' : 'recorded',
    phase, scan: null, exceptions, issuePill: issuePill(phase, exceptions), overridden, relevanceUnknown: phase.relevance === 'unknown',
  }
}

/** One step per parcel record that carries the scan. Records without it contribute nothing; the gap goes in the not-recorded line. */
function scanSteps(journey: ParcelJourney, kind: 'scan-out' | 'scan-in'): ParcelStep[] {
  const out = kind === 'scan-out'
  const title = out ? SCAN_OUT_TITLE : SCAN_IN_TITLE
  return journey.scans.flatMap((scan, index) => {
    const at = out ? scan.scan_out_at : scan.scan_in_at
    if (!at) return []
    const suffix = journey.scans.length > 1 ? ` · parcel record ${index + 1}` : ''
    return [{
      kind, key: `${kind}-${scan.parcel_id}`, title: `${title}${suffix}`, subline: `${fmtDateTime(at)} · ${SCAN_SOURCE_TEXT}`,
      sentence: title.toLowerCase(), marker: 'recorded' as const,
      phase: null, scan, exceptions: [], issuePill: null, overridden: false, relevanceUnknown: false,
    }]
  })
}

function isUnrecordedConsignmentPhase(phase: ParcelTracePhase): boolean {
  return phase.relevance === 'consignment' && !isRecorded(phase) && phase.status !== 'in_progress'
}

/** The next consignment phase after the last recorded one that never happened. In transit is skipped: it is not a place-bound event. */
function nextUnrecordedPhase(journey: ParcelJourney): ParcelTracePhase | null {
  const last = lastRecordedPhase(journey)
  const from = last ? journey.phases.indexOf(last) + 1 : 0
  return journey.phases.slice(from).find(phase => isUnrecordedConsignmentPhase(phase) && phase.phase_type !== 'in_transit') ?? null
}

function cancelledStep(journey: ParcelJourney): ParcelStep {
  const next = nextUnrecordedPhase(journey)
  const subline = !lastRecordedPhase(journey) ? 'before any recorded phase' : next ? `before ${lowerPhaseName(next)}` : 'after the last recorded phase'
  return { kind: 'cancelled', key: 'cancelled', title: 'Trip cancelled', subline, sentence: 'trip cancelled', marker: 'warn', phase: null, scan: null, exceptions: [], issuePill: null, overridden: false, relevanceUnknown: false }
}

/** Ordered steps for one parcel: scan-outs, recorded phases (ledger order), the cancellation, then scan-ins. */
export function parcelSteps(journey: ParcelJourney): ParcelStep[] {
  const byPhase = new Map<string, ParcelTraceException[]>()
  for (const item of journey.exceptions) if (item.phase_event_id) byPhase.set(item.phase_event_id, [...(byPhase.get(item.phase_event_id) ?? []), item])
  const phases = journey.phases.filter(isStepPhase).map(phase => phaseStep(phase, journey, byPhase.get(phase.id) ?? []))
  const cancelled = journey.progress.position === 'cancelled' ? [cancelledStep(journey)] : []
  return [...scanSteps(journey, 'scan-out'), ...phases, ...cancelled, ...scanSteps(journey, 'scan-in')]
}

/**
 * Lower-case names of what has no record, in ledger order, then the seal check and destination scan. Phases stay named, never
 * collapsed. A name that repeats (a cross-dock) gets its place on every occurrence, since the place is what tells them apart.
 */
export function notRecordedItems(journey: ParcelJourney): string[] {
  const unrecorded = journey.phases.filter(isUnrecordedConsignmentPhase)
  const occurrences = new Map<string, number>()
  for (const phase of unrecorded) occurrences.set(lowerPhaseName(phase), (occurrences.get(lowerPhaseName(phase)) ?? 0) + 1)
  const items = unrecorded.map(phase => {
    const name = lowerPhaseName(phase)
    return (occurrences.get(name) ?? 0) > 1 ? `${name} at ${phase.precinct_name ?? UNRECORDED_PLACE}` : name
  })
  if (journey.scans.every(scan => scan.scan_out_at === null)) items.unshift(ORIGIN_SCAN_ITEM)
  const window = relevantSealWindow(journey)
  if (window && OPEN_SEAL_STATUSES.includes(window.status)) items.push(SEAL_CHECK_ITEM)
  if (journey.scans.every(scan => scan.scan_in_at === null)) items.push(DESTINATION_SCAN_ITEM)
  return items
}

export function statusBadge(journey: ParcelJourney): { label: string; type: ChipType } {
  const cancelled = journey.trip_status === 'cancelled' || journey.progress.position === 'cancelled'
  const type = cancelled ? TRIP_STATUS_META.cancelled.chipType : progressChipType(journey.progress)
  if (journey.progress.position !== 'cancelled') return { label: progressLabel(journey.progress, journey.phases), type }
  const last = lastRecordedPhase(journey)
  return { label: last ? `Trip cancelled after ${lowerPhaseName(last)}` : 'Trip cancelled before any recorded phase', type }
}

/**
 * "Last recorded: {the last recorded step} on {time}." and nothing else. What is missing is the not-recorded row's job, so the
 * line above it never says it a second time.
 */
export function statusLine(journey: ParcelJourney): string {
  const last = parcelSteps(journey).findLast(step => step.kind !== 'cancelled')
  if (!last) return NO_RECORDED_STEP
  const at = (last.phase?.completed_at ?? last.scan?.[last.kind === 'scan-in' ? 'scan_in_at' : 'scan_out_at']) ?? null
  return `Last recorded: ${last.sentence}${at ? ` on ${fmtDateTime(at)}.` : `. ${TIME_NOT_RECORDED}.`}`
}

/** What the View trip button's counts stand for that the steps do not show: every phase, and exceptions not attached to a step. */
export function hiddenLedgerCounts(journey: ParcelJourney): { phaseCount: number; tripWideExceptionCount: number } {
  const stepPhaseIds = new Set(parcelSteps(journey).flatMap(step => step.phase ? [step.phase.id] : []))
  const tripWide = journey.exceptions.filter(item => !item.phase_event_id || !stepPhaseIds.has(item.phase_event_id))
  return { phaseCount: journey.phases.length, tripWideExceptionCount: tripWide.length }
}
