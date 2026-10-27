import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TRIP_STATUS_META } from '@shared/lib/constants/status-meta'
import type { ParcelJourney, ParcelTracePhase } from '@shared/lib/types/parcel-trace'
import {
  EXCEPTION_SCOPE_LABELS, RELEVANCE_LABELS, awaitsReview, exceptionCountLabel, exceptionTypeGroups, hiddenLedgerCounts, lastRecordedPhase, locationLabel,
  notRecordedItems, parcelSteps, progressLabel, relevantSealWindow, reviewStatusLabel, scanSummary, severityLabel, statusBadge, statusLine,
  tripEvidenceLink, type ParcelStep,
} from './trace-display'
import {
  makeDeliveredJourney, makeException, makeJourney, makeManifestOnlyJourney, makeMultiStopJourney, makeOverriddenArrivalJourney, makePhase, makeScan,
  makeUnknownRelevanceJourney, makeWayJourney,
} from './__fixtures__/trace'

describe('scope and relevance labels', () => {
  it('labels a trip_context exception as the whole trip, never as other trip context', () => {
    expect(EXCEPTION_SCOPE_LABELS.trip_context).toBe('Whole trip')
    expect(EXCEPTION_SCOPE_LABELS.consignment).toBe('This consignment')
    expect(Object.values(EXCEPTION_SCOPE_LABELS)).not.toContain('Other trip context')
  })
  it('keeps the phase relevance labels unchanged', () => {
    expect(RELEVANCE_LABELS).toEqual({ consignment: 'This consignment', trip_context: 'Other trip context', unknown: 'Relevance unknown' })
  })
})

describe('parcel component type size', () => {
  it('uses no text size under 12px', () => {
    const dir = dirname(fileURLToPath(import.meta.url))
    const sources = readdirSync(dir).filter(name => /\.tsx?$/.test(name) && !/\.test\./.test(name))

    const offenders = sources.filter(name => /text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/.test(readFileSync(join(dir, name), 'utf8')))

    expect(offenders).toEqual([])
  })
})

describe('trace display semantics', () => {
  it('does not claim a delivery confirmation after an override', () => {
    expect(progressLabel({ ...makeJourney().progress, position: 'after_delivery', has_overrides: true })).toBe('Journey resolved with an override')
  })
  it('does not turn the reference precinct into an observed position without a verdict', () => {
    const journey = makeJourney()
    journey.last_recorded_location!.precinct_confirmed = null
    expect(locationLabel(journey)).toBe('Position recorded, facility unverified')
  })
  it('does not put return query parameters inside the phase fragment', () => {
    const url = new URL(tripEvidenceLink('trip', '/parcels?barcode=0001', 'phase'), 'https://example.test')
    expect(url.searchParams.get('returnTo')).toBe('/parcels?barcode=0001')
    expect(url.hash).toBe('#phase-phase')
  })
  it('labels the three backend review states and passes any other value through unchanged', () => {
    expect(reviewStatusLabel('recorded')).toBe('Recorded')
    expect(reviewStatusLabel('needs_review')).toBe('Needs review')
    expect(reviewStatusLabel('reviewed')).toBe('Reviewed')
    expect(reviewStatusLabel('escalated')).toBe('escalated')
  })
  it('counts only needs_review as awaiting review', () => {
    expect(awaitsReview(makeException(1, { review_status: 'needs_review' }))).toBe(true)
    expect(awaitsReview(makeException(2, { review_status: 'recorded' }))).toBe(false)
  })
})

const FORBIDDEN_SUMMARY_WORDS = /\b(lost|stolen|missing|delivered|in custody|left custody|safe|intact|verified)\b/i

function emptyJourney(overrides: Partial<ParcelJourney> = {}): ParcelJourney {
  return makeJourney({
    phases: [], seal_windows: [], scans: [], exceptions: [], gaps: [], last_recorded_location: null,
    progress: { position: 'before_pickup', phase_event_id: null, phase_type: null, phase_status: null, has_overrides: false },
    ...overrides,
  })
}

describe('lastRecordedPhase', () => {
  it('skips trip-context, unknown-relevance and pending phases', () => {
    const phases: ParcelTracePhase[] = [
      makePhase('loading', 0),
      { ...makePhase('departure', 1), relevance: 'trip_context' },
      { ...makePhase('in_transit', 2), status: 'pending', completed_at: null },
      { ...makePhase('arrival', 3), relevance: 'unknown' },
    ]

    expect(lastRecordedPhase(makeJourney({ phases }))?.id).toBe('phase-0')
  })
  it('takes ledger order over timestamps', () => {
    const phases = [
      { ...makePhase('loading', 0), completed_at: '2026-10-07T23:00:00Z' },
      { ...makePhase('departure', 1), completed_at: '2026-10-07T21:00:00Z' },
    ]

    expect(lastRecordedPhase(makeJourney({ phases }))?.id).toBe('phase-1')
  })
  it('counts exception and overridden phases as recorded', () => {
    const phases = [{ ...makePhase('loading', 0), status: 'exception' as const }, { ...makePhase('departure', 1), status: 'overridden' as const }]

    expect(lastRecordedPhase(makeJourney({ phases }))?.id).toBe('phase-1')
    expect(lastRecordedPhase(makeJourney({ phases: phases.slice(0, 1) }))?.id).toBe('phase-0')
  })
  it('is null when no consignment phase is recorded', () => {
    expect(lastRecordedPhase(emptyJourney())).toBeNull()
    expect(lastRecordedPhase(makeJourney({ phases: [{ ...makePhase('loading', 0), status: 'pending', completed_at: null }] }))).toBeNull()
  })
})

describe('relevantSealWindow', () => {
  it('is the window containing the last recorded phase when that phase is in a leg', () => {
    const journey = makeMultiStopJourney()

    expect(relevantSealWindow(journey)?.departure_phase_id).toBe('phase-7')
  })
  it('falls back to the last window whose departure is recorded when the last phase is after every leg', () => {
    const journey = makeJourney()
    journey.phases[4] = { ...journey.phases[4], status: 'completed', completed_at: '2026-10-08T01:00:00Z', anchor_status: 'anchored' }

    expect(lastRecordedPhase(journey)?.id).toBe('phase-4')
    expect(relevantSealWindow(journey)?.departure_phase_id).toBe('phase-1')
  })
  it('is null when there is no window or no window has a recorded departure', () => {
    expect(relevantSealWindow(makeJourney({ seal_windows: [] }))).toBeNull()
    const journey = makeJourney()
    journey.phases[1] = { ...journey.phases[1], status: 'pending', completed_at: null }
    expect(relevantSealWindow(journey)).toBeNull()
  })
})

describe('exceptionCountLabel', () => {
  it('uses the shared plural rule and counts only needs_review as awaiting review', () => {
    expect(exceptionCountLabel([])).toBe('0 exceptions')
    expect(exceptionCountLabel([makeException(1, { review_status: 'recorded' })])).toBe('1 exception')
    expect(exceptionCountLabel([makeException(1), makeException(2, { review_status: 'reviewed' })])).toBe('2 exceptions · 1 needs review')
    expect(exceptionCountLabel([makeException(1), makeException(2)])).toBe('2 exceptions · 2 need review')
  })
})

describe('exceptionTypeGroups', () => {
  it('groups by type in first-seen order with a count and a needs-review count', () => {
    const groups = exceptionTypeGroups([
      makeException(1, { exception_type: 'gps_mismatch', review_status: 'needs_review' }),
      makeException(2, { exception_type: 'tracker_silent', review_status: 'reviewed' }),
      makeException(3, { exception_type: 'gps_mismatch', review_status: 'recorded' }),
      makeException(4, { exception_type: 'gps_mismatch', review_status: 'needs_review' }),
    ])

    expect(groups.map(group => [group.type, group.label, group.count, group.needsReview])).toEqual([
      ['gps_mismatch', 'GPS mismatch', 3, 2],
      ['tracker_silent', 'Tracker silent', 1, 0],
    ])
    expect(groups.map(group => group.summary)).toEqual(['GPS mismatch ×3 · 2 need review', 'Tracker silent ×1'])
  })
  it('keeps repeated descriptions in one group and labels an unknown type generically', () => {
    const groups = exceptionTypeGroups([makeException(1, { exception_type: 'odd_new_type', description: 'Same' }), makeException(2, { exception_type: 'odd_new_type', description: 'Same' })])

    expect(groups).toHaveLength(1)
    expect(groups[0].label).toBe('Odd New Type')
    expect(groups[0].summary).toBe('Odd New Type ×2 · 2 need review')
  })
  it('is empty for no exceptions', () => {
    expect(exceptionTypeGroups([])).toEqual([])
  })
})

describe('scanSummary', () => {
  it('says no record is retained when there are no parcel records', () => {
    expect(scanSummary([])).toBe('No retained scan record')
  })
  it('gives the scan-out time when the records agree and the earliest when they differ', () => {
    expect(scanSummary([makeScan(1)])).toBe('Scan-out 08 Oct, 00:00 SAST')
    expect(scanSummary([makeScan(1), makeScan(2)])).toBe('Scan-out 08 Oct, 00:00 SAST')
    expect(scanSummary([makeScan(1, { scan_out_at: '2026-10-07T22:00:00Z' }), makeScan(2, { scan_out_at: '2026-10-07T20:00:00Z' })])).toBe('Scan-out on 2 parcel records, earliest 07 Oct, 22:00 SAST')
  })
  it('distinguishes a retained record with no scan-out from no record at all', () => {
    expect(scanSummary([makeScan(1, { scan_out_at: null })])).toBe('No scan-out recorded')
  })
})

/** [title, subline] per step, so a test reads as the list the dispatcher would see. */
function lines(steps: readonly ParcelStep[]): Array<[string, string]> {
  return steps.map(step => [step.title, step.subline])
}

describe('parcelSteps', () => {
  it('gives the WAY0020001 shape exactly: scan-out, loaded, departed under seal, cancelled', () => {
    const steps = parcelSteps(makeWayJourney())

    expect(lines(steps)).toEqual([
      ['Scanned out at origin', '15 Oct, 11:58 SAST · parcel scan'],
      ['Consignment loaded', '15 Oct, 11:30 SAST · Origin Depot · vehicle CA 123456'],
      ['Departed, sealed SEAL-WAY', '15 Oct, 12:10 SAST · Origin Depot'],
      ['Trip cancelled', 'before arrival'],
    ])
    expect(steps.map(step => step.kind)).toEqual(['scan-out', 'phase', 'phase', 'cancelled'])
  })
  it('never makes a trip_context phase a step, even when it is recorded and has exceptions', () => {
    const steps = parcelSteps(makeWayJourney())

    const ids = steps.flatMap(step => step.phase ? [step.phase.id] : [])
    expect(ids).toEqual(['phase-2', 'phase-3'])
  })
  it('puts the issue pill on a step from its linked exceptions, at most one pill', () => {
    const steps = parcelSteps(makeWayJourney())

    expect(steps.map(step => step.issuePill)).toEqual([null, '3 exceptions · 2 need review', '3 exceptions · 1 needs review', null])
    expect(steps[1].exceptions.map(item => item.id)).toEqual(['exception-4', 'exception-5', 'exception-6'])
    expect(steps[2].exceptions.map(item => item.id)).toEqual(['exception-7', 'exception-8', 'exception-9'])
  })
  it('falls back to the location verdict for the pill only when a step has no exceptions and the verdict is a mismatch or unwitnessed', () => {
    const verdicts = ['mismatch', 'unwitnessed', 'confirmed', 'not_recorded'] as const
    const pills = verdicts.map(location_verdict => {
      const journey = makeJourney({ phases: [{ ...makePhase('loading', 0), location_verdict }] })
      return parcelSteps(journey).find(step => step.kind === 'phase')!.issuePill
    })

    expect(pills).toEqual(['Truck outside precinct tolerance', 'No recorded tracker confirmation', null, null])
  })
  it('prefers the exception count over the location verdict', () => {
    const journey = makeJourney({ phases: [{ ...makePhase('loading', 0), location_verdict: 'mismatch' }], exceptions: [makeException(1, { phase_event_id: 'phase-0' })] })

    expect(parcelSteps(journey).find(step => step.kind === 'phase')!.issuePill).toBe('1 exception · 1 needs review')
  })
  it('ends a delivered shape with a scan-in step and never uses the word delivered', () => {
    const steps = parcelSteps(makeDeliveredJourney())

    expect(lines(steps)).toEqual([
      ['Scanned out at origin', '08 Oct, 00:00 SAST · parcel scan'],
      ['Consignment loaded', '08 Oct, 00:30 SAST · Origin Depot · vehicle CA 123456'],
      ['Departed, sealed SEAL-DEL', '08 Oct, 00:30 SAST · Origin Depot'],
      ['In transit recorded', '08 Oct, 00:30 SAST · Origin Depot'],
      ['Arrived at Destination Depot', '08 Oct, 00:30 SAST · Destination Depot'],
      ['Consignment unloaded', '08 Oct, 00:30 SAST · Destination Depot'],
      ['Confirmation recorded', '08 Oct, 00:30 SAST · Destination Depot'],
      ['Scanned in at destination', '16 Oct, 10:00 SAST · parcel scan'],
    ])
    expect(steps.at(-1)!.kind).toBe('scan-in')
    expect(steps.every(step => step.issuePill === null)).toBe(true)
    expect(JSON.stringify(lines(steps))).not.toMatch(/delivered/i)
  })
  it('marks an overridden phase in its title and as an overridden step, never as a plain arrival', () => {
    const arrival = parcelSteps(makeOverriddenArrivalJourney()).find(step => step.phase?.phase_type === 'arrival')!

    expect(arrival.title).toBe('Arrived at Destination Depot (overridden)')
    expect(arrival.overridden).toBe(true)
    expect(arrival.relevanceUnknown).toBe(false)
  })
  it('tags a recorded unknown-relevance phase as a step instead of dropping or promoting it', () => {
    const steps = parcelSteps(makeUnknownRelevanceJourney())

    const departure = steps.find(step => step.phase?.phase_type === 'departure')!
    expect(departure.relevanceUnknown).toBe(true)
    expect(departure.title).toBe('Departed, sealed SEAL-WAY')
    expect(steps.filter(step => step.relevanceUnknown)).toHaveLength(1)
  })
  it('leaves an unrecorded unknown-relevance phase out', () => {
    const journey = makeJourney({ phases: [{ ...makePhase('loading', 0), relevance: 'unknown', status: 'pending', completed_at: null }] })

    expect(parcelSteps(journey).some(step => step.kind === 'phase')).toBe(false)
  })
  it('shows an in-progress phase with a ring marker and no recorded time', () => {
    const journey = makeJourney({ phases: [{ ...makePhase('loading', 0), status: 'in_progress', completed_at: null }] })

    const step = parcelSteps(journey).find(item => item.kind === 'phase')!

    expect(step.title).toBe('Loading in progress')
    expect(step.subline).toBe('Time not recorded · Origin Depot · vehicle CA 123456')
    expect(step.marker).toBe('in_progress')
  })
  it('uses the seal from the containing window when the departure phase has none, and no seal wording when neither has one', () => {
    const fromWindow = makeJourney({ phases: [makePhase('departure', 1)], seal_windows: [{ ...makeJourney().seal_windows[0], phase_ids: ['phase-1'], departure_seal: 'SEAL-WIN' }] })
    const neither = makeJourney({ phases: [makePhase('departure', 1)], seal_windows: [] })

    expect(parcelSteps(fromWindow).find(step => step.kind === 'phase')!.title).toBe('Departed, sealed SEAL-WIN')
    expect(parcelSteps(neither).find(step => step.kind === 'phase')!.title).toBe('Departed')
  })
  it('titles an arrival without a place, and a phase without a place or time, with the plain fallbacks', () => {
    const journey = makeJourney({ phases: [{ ...makePhase('arrival', 0), precinct_name: null, completed_at: null }, { ...makePhase('confirmation', 1), precinct_name: null }] })

    const steps = parcelSteps(journey).filter(step => step.kind === 'phase')

    expect(lines(steps)).toEqual([
      ['Arrival recorded', 'Time not recorded · Trip-wide record'],
      ['Confirmation recorded', '08 Oct, 00:30 SAST · Trip-wide record'],
    ])
  })
  it('names a phase type with no special wording from the phase name', () => {
    const journey = makeJourney({ phases: [{ ...makePhase('trip_creation', 0), relevance: 'unknown' }], seal_windows: [] })

    expect(parcelSteps(journey).find(step => step.kind === 'phase')!.title).toBe('Trip Created recorded')
  })
  it('keeps several parcel records as separate suffixed steps, positioned rather than time-sorted', () => {
    const scans = [
      makeScan(1, { scan_out_at: '2026-10-07T23:00:00Z' }),
      makeScan(2, { scan_out_at: '2026-10-07T21:00:00Z', scan_in_at: '2026-10-08T05:00:00Z', status: 'scanned_in' }),
    ]

    const steps = parcelSteps(makeJourney({ scans }))

    expect(steps.filter(step => step.kind === 'scan-out' || step.kind === 'scan-in').map(step => step.title)).toEqual([
      'Scanned out at origin · parcel record 1',
      'Scanned out at origin · parcel record 2',
      'Scanned in at destination · parcel record 2',
    ])
    expect(steps[0].kind).toBe('scan-out')
    expect(steps.at(-1)!.kind).toBe('scan-in')
  })
  it('gives a record with no scans nothing, and never suffixes a single record', () => {
    const none = parcelSteps(makeJourney({ scans: [makeScan(1, { scan_out_at: null })] }))
    const one = parcelSteps(makeJourney())

    expect(none.some(step => step.kind === 'scan-out' || step.kind === 'scan-in')).toBe(false)
    expect(one[0].title).toBe('Scanned out at origin')
  })
  it('adds a cancelled step after the last recorded step and before any scan-in, without a time', () => {
    const journey = makeWayJourney({ scans: [makeScan(1, { scan_out_at: '2026-10-15T09:58:00Z', scan_in_at: '2026-10-15T20:00:00Z' })] })

    const steps = parcelSteps(journey)

    expect(steps.map(step => step.kind)).toEqual(['scan-out', 'phase', 'phase', 'cancelled', 'scan-in'])
    expect(steps[3].marker).toBe('warn')
    expect(steps[3].subline).not.toMatch(/SAST|\d{2}:\d{2}/)
  })
  it('says a cancelled trip was cancelled before any recorded phase when none is recorded', () => {
    const journey = makeJourney({ phases: [], seal_windows: [], scans: [], progress: { position: 'cancelled', phase_event_id: null, phase_type: null, phase_status: null, has_overrides: false } })

    expect(lines(parcelSteps(journey))).toEqual([['Trip cancelled', 'before any recorded phase']])
  })
  it('has no steps for a parcel with nothing recorded', () => {
    expect(parcelSteps(makeJourney({ phases: [], seal_windows: [], scans: [] }))).toEqual([])
  })
})

describe('notRecordedItems', () => {
  it('lists the WAY0020001 gaps in ledger order, then the seal check and destination scan', () => {
    expect(notRecordedItems(makeWayJourney())).toEqual(['in transit', 'arrival', 'unloading', 'confirmation', 'seal check', 'destination scan'])
  })
  it('adds the place to every occurrence of a repeated phase name and leaves single occurrences bare', () => {
    const at = (kind: Parameters<typeof makePhase>[0], index: number, place: string | null) => ({ ...makePhase(kind, index), status: 'pending' as const, completed_at: null, precinct_name: place })
    const journey = makeJourney({
      phases: [
        makePhase('loading', 0), makePhase('departure', 1),
        at('in_transit', 2, 'Origin Depot'), at('arrival', 3, 'Cross-dock B'), at('loading', 4, 'Cross-dock B'), at('departure', 5, 'Cross-dock B'),
        at('in_transit', 6, 'Cross-dock B'), at('arrival', 7, null), at('unloading', 8, 'Destination Depot'),
      ],
      seal_windows: [],
    })

    expect(notRecordedItems(journey)).toEqual([
      'in transit at Origin Depot', 'arrival at Cross-dock B', 'loading', 'departure', 'in transit at Cross-dock B', 'arrival at an unrecorded place', 'unloading', 'destination scan',
    ])
  })
  it('is empty for a fully recorded, matched, scanned-in journey', () => {
    expect(notRecordedItems(makeDeliveredJourney())).toEqual([])
  })
  it('excludes in-progress phases, trip_context phases and unknown-relevance phases', () => {
    const journey = makeJourney({
      phases: [
        { ...makePhase('loading', 0), status: 'in_progress', completed_at: null },
        { ...makePhase('departure', 1), status: 'pending', completed_at: null, relevance: 'trip_context' },
        { ...makePhase('in_transit', 2), status: 'pending', completed_at: null, relevance: 'unknown' },
        { ...makePhase('arrival', 3), status: 'pending', completed_at: null },
      ],
      seal_windows: [],
      scans: [makeScan(1, { scan_in_at: '2026-10-08T05:00:00Z', status: 'scanned_in' })],
    })

    expect(notRecordedItems(journey)).toEqual(['arrival'])
  })
  it('adds the seal check for pending and unverified windows only', () => {
    const itemsFor = (status: 'matched' | 'mismatch' | 'pending' | 'unverified'): string[] => {
      const journey = makeDeliveredJourney()
      journey.seal_windows[0] = { ...journey.seal_windows[0], status }
      return notRecordedItems(journey)
    }

    expect(itemsFor('pending')).toEqual(['seal check'])
    expect(itemsFor('unverified')).toEqual(['seal check'])
    expect(itemsFor('matched')).toEqual([])
    expect(itemsFor('mismatch')).toEqual([])
  })
  it('adds the destination scan unless some parcel record has a scan-in, and also when there are no records', () => {
    const withScanIn = makeDeliveredJourney()
    const without = makeDeliveredJourney({ scans: [makeScan(1)] })

    expect(notRecordedItems(withScanIn)).not.toContain('destination scan')
    expect(notRecordedItems(without)).toEqual(['destination scan'])
  })
  it('names the origin scan-out first when no parcel record has one, including when there are no records at all', () => {
    const none = notRecordedItems(makeDeliveredJourney({ scans: [] }))
    const noScanOut = notRecordedItems(makeDeliveredJourney({ scans: [makeScan(1, { scan_out_at: null, scan_in_at: '2026-10-08T05:00:00Z', status: 'scanned_in' })] }))

    expect(none).toEqual(['origin scan-out', 'destination scan'])
    expect(noScanOut).toEqual(['origin scan-out'])
  })
  it('leaves the origin scan-out out once any parcel record has one', () => {
    const journey = makeDeliveredJourney({ scans: [makeScan(1, { scan_out_at: null }), makeScan(2, { scan_in_at: '2026-10-08T05:00:00Z', status: 'scanned_in' })] })

    expect(notRecordedItems(journey)).toEqual([])
  })
  it('puts the origin scan-out ahead of the unrecorded phases', () => {
    const journey = makeWayJourney({ scans: [] })

    expect(notRecordedItems(journey)).toEqual(['origin scan-out', 'in transit', 'arrival', 'unloading', 'confirmation', 'seal check', 'destination scan'])
  })
})

describe('statusBadge', () => {
  it('names the last recorded consignment phase for a cancelled trip', () => {
    expect(statusBadge(makeWayJourney())).toEqual({ label: 'Trip cancelled after departure', type: 'critical' })
  })
  it('takes the shared cancelled chip type for a cancelled trip, by status or by position', () => {
    const byStatus = makeJourney({ trip_status: 'cancelled' })
    const byPosition = makeJourney({ phases: [], progress: { position: 'cancelled', phase_event_id: null, phase_type: null, phase_status: null, has_overrides: false } })

    expect(statusBadge(byStatus).type).toBe(TRIP_STATUS_META.cancelled.chipType)
    expect(statusBadge(byPosition).type).toBe(TRIP_STATUS_META.cancelled.chipType)
    expect(TRIP_STATUS_META.cancelled.chipType).toBe('critical')
  })
  it('says before any recorded phase when a cancelled trip recorded none', () => {
    const journey = makeJourney({ phases: [], progress: { position: 'cancelled', phase_event_id: null, phase_type: null, phase_status: null, has_overrides: false } })

    expect(statusBadge(journey).label).toBe('Trip cancelled before any recorded phase')
  })
  it('uses the existing progress wording and chip type for every other position', () => {
    expect(statusBadge(makeDeliveredJourney())).toEqual({ label: 'Delivery phase recorded', type: 'complete' })
    expect(statusBadge(makeOverriddenArrivalJourney())).toEqual({ label: 'Journey resolved with an override', type: 'exception' })
    expect(statusBadge(makeJourney()).label).toBe('In transit, awaiting arrival attestation')
  })
})

describe('statusLine', () => {
  it('is the last recorded step and its time, and nothing else, for the WAY0020001 shape', () => {
    expect(statusLine(makeWayJourney())).toBe('Last recorded: departed Origin Depot under seal SEAL-WAY on 15 Oct, 12:10 SAST.')
  })
  it('leads with the scan-in when that is the last step', () => {
    const journey = makeJourney({ scans: [makeScan(1, { scan_in_at: '2026-10-08T05:00:00Z', status: 'scanned_in' })], seal_windows: [] })

    expect(statusLine(journey)).toBe('Last recorded: scanned in at destination on 08 Oct, 07:00 SAST.')
  })
  it('leaves everything that is missing to the not-recorded row', () => {
    const journeys = [makeWayJourney({ scans: [] }), makeDeliveredJourney({ scans: [makeScan(1)] }), makeJourney()]

    for (const journey of journeys) expect(statusLine(journey)).not.toMatch(/ No .* recorded\./)
    expect(statusLine(makeWayJourney({ scans: [] }))).toBe('Last recorded: departed Origin Depot under seal SEAL-WAY on 15 Oct, 12:10 SAST.')
  })
  it('reads an overridden last step with its marker and says the time is not recorded rather than inventing one', () => {
    const journey = makeOverriddenArrivalJourney({ scans: [] })
    journey.phases = journey.phases.map(phase => {
      if (phase.phase_type === 'arrival') return { ...phase, completed_at: null }
      if (phase.phase_type === 'unloading' || phase.phase_type === 'confirmation') return { ...phase, status: 'pending' as const, completed_at: null }
      return phase
    })

    expect(statusLine(journey)).toBe('Last recorded: arrived at Destination Depot (overridden). Time not recorded.')
  })
  it('falls back when no step is recorded, even if the trip is cancelled', () => {
    const nothing = makeJourney({ phases: [], seal_windows: [], scans: [] })
    const cancelled = makeJourney({ phases: [], seal_windows: [], scans: [], progress: { position: 'cancelled', phase_event_id: null, phase_type: null, phase_status: null, has_overrides: false } })

    expect(statusLine(nothing)).toBe('No recorded step for this parcel yet.')
    expect(statusLine(cancelled)).toBe('No recorded step for this parcel yet.')
  })
})

describe('severityLabel', () => {
  it('uses the shared severity wording for the three known severities', () => {
    expect(severityLabel('info')).toBe('Info')
    expect(severityLabel('warning')).toBe('Warning')
    expect(severityLabel('critical')).toBe('Critical')
  })
  it('shows an unexpected severity as it arrives rather than guessing', () => {
    expect(severityLabel('high')).toBe('high')
  })
})

describe('hiddenLedgerCounts', () => {
  it('counts all 8 phases and the 4 trip-wide exceptions for the WAY0020001 shape', () => {
    expect(hiddenLedgerCounts(makeWayJourney())).toEqual({ phaseCount: 8, tripWideExceptionCount: 4 })
  })
  it('counts exceptions on a pending non-step phase and on an unknown phase id, but not those on a step', () => {
    const journey = makeJourney({
      exceptions: [
        makeException(1, { phase_event_id: 'phase-0' }),
        makeException(2, { phase_event_id: 'phase-2' }),
        makeException(3, { phase_event_id: 'phase-ghost' }),
        makeException(4, { phase_event_id: null }),
      ],
    })

    expect(hiddenLedgerCounts(journey)).toEqual({ phaseCount: 5, tripWideExceptionCount: 3 })
  })
  it('is zero exceptions for a journey whose exceptions all sit on steps', () => {
    const journey = makeDeliveredJourney({ exceptions: [makeException(1, { phase_event_id: 'phase-2' })] })

    expect(hiddenLedgerCounts(journey)).toEqual({ phaseCount: 8, tripWideExceptionCount: 0 })
  })
})

describe('parcel-first helpers never claim an unsupported outcome', () => {
  it('stays clear of forbidden words for every fixture', () => {
    const cancelledNone = makeJourney({ phases: [], seal_windows: [], scans: [], progress: { position: 'cancelled', phase_event_id: null, phase_type: null, phase_status: null, has_overrides: false } })
    const journeys = [
      makeJourney(), makeMultiStopJourney(), makeWayJourney(), makeDeliveredJourney(), makeOverriddenArrivalJourney(), makeUnknownRelevanceJourney(),
      makeManifestOnlyJourney(), emptyJourney(), cancelledNone, makeJourney({ scans: [makeScan(1), makeScan(2, { scan_in_at: '2026-10-08T05:00:00Z' })] }),
    ]

    for (const journey of journeys) {
      const text = [
        ...parcelSteps(journey).flatMap(step => [step.title, step.subline, step.sentence, step.issuePill ?? '']),
        ...notRecordedItems(journey), statusBadge(journey).label, statusLine(journey),
      ].join(' | ')
      expect(text).not.toMatch(FORBIDDEN_SUMMARY_WORDS)
    }
  })
})
