import { describe, expect, it } from 'vitest'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { ExceptionReviewStatus, ExceptionSeverity, ExceptionType, TripException, ExceptionId } from '@shared/lib/types/exception'
import type { TripStatus } from '@shared/lib/types/trip'
import type { CheckKey, CheckResult, PhaseCheck } from './checks'
import { CONFIRM_VERBS, phaseVerdict, type PhaseOutcome, type PhaseVerdict, type PhaseVerdictInput } from './verdict'

// Single-leg plan: 0 trip_creation, 1 activation, 2 loading, 3 departure, 4 in_transit,
// 5 arrival, 6 unloading, 7 confirmation.
const SEQ = { creation: 0, activation: 1, loading: 2, departure: 3, transit: 4, arrival: 5, unloading: 6, confirmation: 7 } as const

const DEPARTED_AT = '2026-10-13T07:00:00Z' // 09:00 SAST
const NOW_MS = Date.parse('2026-10-13T10:12:00Z') // 12:12 SAST

function phase(seq: number, patch: Partial<PhaseDescriptor> = {}): PhaseDescriptor {
  return { ...SINGLE_LEG_PHASE_PLAN.find(p => p.sequence_number === seq)!, ...patch }
}

function check(key: CheckKey, result: CheckResult, title = `${key} ${result}`): PhaseCheck {
  return { key, result, title, detail: `${key} detail` }
}

function exception(
  review: ExceptionReviewStatus,
  type: ExceptionType = 'route_deviation',
  severity: ExceptionSeverity = 'warning',
  id = `exc-${review}-${type}`,
): TripException {
  return { id: id as ExceptionId, exception_type: type, severity, review_status: review } as TripException
}

const COMPLETED: Partial<PhaseDescriptor> = { status: 'completed', completed_at: '2026-10-13T08:00:00Z' }

function verdictFor(over: Partial<PhaseVerdictInput> & { phase: PhaseDescriptor }): PhaseVerdict | null {
  return phaseVerdict({
    checks: [], exceptions: [], actCounts: { uploads: 0 }, isActive: false,
    tripStatus: 'active' as TripStatus, leg: null, nowMs: NOW_MS,
    ...over,
  })
}

const PASSES: PhaseCheck[] = [check('truck_geofence', 'pass', 'Truck within precinct tolerance')]

describe('transit confirmation and duration (D47)', () => {
  it('counts arrival findings separately from road events and keeps departure on a finished leg', () => {
    const p = phase(SEQ.transit, COMPLETED)
    const finding = { ...exception('needs_review', 'driver_vehicle_separation'), source: 'system' as const, checkpoint_id: null, phase_event_id: p.phase_event_id }
    const v = verdictFor({ phase: p, exceptions: [finding], leg: { departedAt: DEPARTED_AT, arrivedAt: p.completed_at } })

    expect(v?.reasons.join(' · ')).toContain('1 at arrival check')
    expect(v?.reasons.join(' · ')).not.toContain('en route')
    expect(v?.reasons.join(' · ')).toContain('Departed')
  })

  it('keeps only the duration together using non-breaking spaces', () => {
    const v = verdictFor({ phase: phase(SEQ.transit, { ...COMPLETED, completed_at: '2026-10-13T08:35:00Z' }), leg: { departedAt: DEPARTED_AT, arrivedAt: '2026-10-13T08:35:00Z' } })

    expect(v?.reasons).toContain('1\u00a0h\u00a035\u00a0m on the road')
  })
})

describe('outcome precedence', () => {
  it('overridden outranks everything', () => {
    const v = verdictFor({
      phase: phase(SEQ.loading, { status: 'overridden', completed_at: '2026-10-13T08:00:00Z' }),
      checks: [check('bypassed', 'not_checked', 'Checks bypassed')],
      exceptions: [exception('needs_review')],
    })

    expect(v?.outcome).toBe('overridden')
    expect(v?.headline).toBe('Closed by dispatcher override')
  })

  it('attention beats reviewed, unverified and clean', () => {
    const flagged = [check('parcels', 'flag', '1 parcel not scanned'), check('truck_geofence', 'not_checked'), check('driver_proximity', 'pass')]
    const v = verdictFor({ phase: phase(SEQ.loading, COMPLETED), checks: flagged, exceptions: [exception('reviewed')] })

    expect(v?.outcome).toBe('attention')
  })

  it('an unreviewed exception is attention even when every check passed', () => {
    const v = verdictFor({ phase: phase(SEQ.loading, COMPLETED), checks: PASSES, exceptions: [exception('needs_review')] })

    expect(v?.outcome).toBe('attention')
    expect(v?.headline).toBe('Needs attention')
    expect(v?.reasons).toContain('1 exception to review')
  })

  it('names the flagged check as a reason', () => {
    const v = verdictFor({ phase: phase(SEQ.confirmation, COMPLETED), checks: [check('counts', 'flag', '1 parcel unaccounted for')] })

    expect(v?.outcome).toBe('attention')
    expect(v?.reasons).toContain('1 parcel unaccounted for')
  })

  it('reviewed: exceptions exist, all reviewed, no flagged check', () => {
    const v = verdictFor({ phase: phase(SEQ.loading, COMPLETED), checks: [...PASSES, check('driver_proximity', 'not_checked')], exceptions: [exception('reviewed')] })

    expect(v?.outcome).toBe('reviewed')
    expect(v?.headline).toBe('Exception reviewed')
    expect(v?.reasons).toContain('Route Deviation (warning)')
  })

  it('reviewed beats unverified', () => {
    const v = verdictFor({ phase: phase(SEQ.loading, COMPLETED), checks: [check('truck_geofence', 'not_checked')], exceptions: [exception('reviewed')] })

    expect(v?.outcome).toBe('reviewed')
  })

  it('an exception that only needs recording is not claimed as reviewed', () => {
    const v = verdictFor({ phase: phase(SEQ.loading, COMPLETED), checks: PASSES, exceptions: [exception('recorded', 'tracker_silent', 'info')] })

    expect(v?.outcome).toBe('reviewed')
    expect(v?.headline).toBe('Exception recorded')
  })

  it('unverified: nothing flagged, but a check could not run', () => {
    const v = verdictFor({ phase: phase(SEQ.loading, COMPLETED), checks: [check('parcels', 'pass', 'All parcels scanned'), check('truck_geofence', 'not_checked', 'Truck precinct check unavailable')] })

    expect(v?.outcome).toBe('unverified')
    expect(v?.headline).toBe('Not fully verified')
    expect(v?.reasons).toContain('Truck precinct check unavailable')
  })

  it('a resolved phase with no checks at all cannot be clean', () => {
    expect(verdictFor({ phase: phase(SEQ.loading, COMPLETED), checks: [] })?.outcome).toBe('unverified')
  })

  it('clean: no exception, no flag, nothing unrun, at least one pass', () => {
    const v = verdictFor({ phase: phase(SEQ.loading, COMPLETED), checks: [check('parcels', 'pass', 'All parcels scanned'), ...PASSES] })

    expect(v?.outcome).toBe('clean')
    expect(v?.headline).toBe('Checks passed')
    // Short on purpose: the passing checks themselves are listed in the Checked zone.
    expect(v?.reasons).toEqual(['2 checks'])
  })

  it('clean counts a single passing check in the singular', () => {
    const v = verdictFor({ phase: phase(SEQ.loading, COMPLETED), checks: [check('parcels', 'pass', 'All parcels scanned')] })

    expect(v?.outcome).toBe('clean')
    expect(v?.reasons).toEqual(['1 check'])
  })

  it('in_progress when unresolved, active, with uploads', () => {
    const v = verdictFor({ phase: phase(SEQ.departure), isActive: true, actCounts: { uploads: 2 } })

    expect(v?.outcome).toBe('in_progress')
    expect(v?.headline).toBe('In progress')
    expect(v?.reasons).toEqual(['2 photos uploaded', 'Waiting for the driver to confirm departure'])
  })

  it('current for an active phase with no uploads', () => {
    const v = verdictFor({ phase: phase(SEQ.departure), isActive: true })

    expect(v?.outcome).toBe('current')
    expect(v?.headline).toBe('Current phase')
    expect(v?.reasons).toEqual(['Waiting for the driver'])
  })

  it('an unreviewed critical exception on a running phase outranks in_progress', () => {
    const v = verdictFor({
      phase: phase(SEQ.departure), isActive: true, actCounts: { uploads: 1 },
      exceptions: [exception('needs_review', 'seal_mismatch', 'critical')],
    })

    expect(v?.outcome).toBe('attention')
  })

  it('a reviewed exception does not outrank in_progress', () => {
    const v = verdictFor({ phase: phase(SEQ.departure), isActive: true, actCounts: { uploads: 1 }, exceptions: [exception('reviewed')] })

    expect(v?.outcome).toBe('in_progress')
  })

  it('a phase whose own status is exception is never clean when its exceptions did not load', () => {
    const v = verdictFor({ phase: phase(SEQ.loading, { ...COMPLETED, status: 'exception' }), checks: PASSES, exceptions: [] })

    expect(v?.outcome).toBe('unverified')
    expect(v?.headline).toBe('Not fully verified')
    expect(v?.reasons).toContain('Exception recorded on this phase; details not loaded')
    expect(v?.reasons).not.toContain('No exceptions')
  })

  it('an in_transit leg with status exception and no loaded exceptions does not claim "No exceptions recorded"', () => {
    const v = verdictFor({
      phase: phase(SEQ.transit, { status: 'exception', completed_at: '2026-10-13T07:40:00Z' }),
      leg: { departedAt: DEPARTED_AT, arrivedAt: '2026-10-13T07:40:00Z' },
    })

    expect(v?.outcome).toBe('unverified')
    expect(v?.headline).not.toBe('No exceptions recorded')
    expect(v?.reasons).toContain('Exception recorded on this phase; details not loaded')
  })

  it('mixed reviewed and merely recorded exceptions are not all "reviewed"', () => {
    const v = verdictFor({
      phase: phase(SEQ.loading, COMPLETED), checks: PASSES,
      exceptions: [exception('reviewed'), exception('recorded', 'tracker_silent', 'info', 'exc-2')],
    })

    expect(v?.outcome).toBe('reviewed')
    expect(v?.headline).toBe('Exceptions recorded')
    expect(v?.reasons).toContain('2 exceptions')
  })

  it('a not-started phase with an unreviewed exception becomes attention', () => {
    const v = verdictFor({ phase: phase(SEQ.arrival), isActive: false, exceptions: [exception('needs_review')] })

    expect(v?.outcome).toBe('attention')
    expect(v?.nodeType).toBe('warn')
  })

  it('names the warehouse scan only when the phase is blocked on it', () => {
    const blocked = verdictFor({ phase: phase(SEQ.loading, { blocked_on: 'warehouse_scan' }), isActive: true, actCounts: { uploads: 1 } })
    const other = verdictFor({ phase: phase(SEQ.loading, { blocked_on: 'something_else' }), isActive: true, actCounts: { uploads: 1 } })

    expect(blocked?.reasons).toContain('Waiting for the warehouse scan to finish')
    expect(other?.reasons).toContain('Waiting for the driver to confirm loading')
  })

  it('has no verdict for a phase that has not started', () => {
    expect(verdictFor({ phase: phase(SEQ.arrival), isActive: false })).toBeNull()
  })

  it('treats Activation on a still-created trip as not started', () => {
    expect(verdictFor({ phase: phase(SEQ.activation), isActive: true, tripStatus: 'created' })).toBeNull()
  })
})

describe('anchor state is not an input (D29)', () => {
  it('an anchor-failed phase with passing checks is still clean', () => {
    const v = verdictFor({ phase: phase(SEQ.loading, { ...COMPLETED, anchor_status: 'failed' }), checks: PASSES })

    expect(v?.outcome).toBe('clean')
  })
})

describe('location (D43)', () => {
  it('a null truck verdict is unverified, never clean', () => {
    const v = verdictFor({ phase: phase(SEQ.departure, COMPLETED), checks: [check('truck_geofence', 'not_checked')] })

    expect(v?.outcome).toBe('unverified')
  })

  it('an unverified driver proximity is unverified, never clean', () => {
    const v = verdictFor({ phase: phase(SEQ.departure, COMPLETED), checks: [check('truck_geofence', 'pass'), check('driver_proximity', 'not_checked')] })

    expect(v?.outcome).toBe('unverified')
  })

  it('a legacy phase with a passing geofence and no proximity check can be clean', () => {
    const v = verdictFor({ phase: phase(SEQ.departure, COMPLETED), checks: [check('truck_geofence', 'pass')] })

    expect(v?.outcome).toBe('clean')
  })

  it('a truck inside the precinct with a separated driver is attention, never clean', () => {
    const v = verdictFor({ phase: phase(SEQ.departure, COMPLETED), checks: [check('truck_geofence', 'pass'), check('driver_proximity', 'flag', 'Driver separated from truck')] })

    expect(v?.outcome).toBe('attention')
    expect(v?.reasons).toContain('Driver separated from truck')
  })
})

describe('node type', () => {
  it('is warn for every attention, including a completed phase with a flagged check', () => {
    const v = verdictFor({ phase: phase(SEQ.confirmation, COMPLETED), checks: [check('counts', 'flag')] })

    expect(v?.outcome).toBe('attention')
    expect(v?.nodeType).toBe('warn')
  })

  it('is warn for an unresolved running phase needing attention', () => {
    const v = verdictFor({ phase: phase(SEQ.departure), isActive: true, exceptions: [exception('needs_review')] })

    expect(v?.nodeType).toBe('warn')
  })

  it('follows the phase when there is nothing to flag', () => {
    expect(verdictFor({ phase: phase(SEQ.loading, COMPLETED), checks: PASSES })?.nodeType).toBe('done')
    expect(verdictFor({ phase: phase(SEQ.departure), isActive: true })?.nodeType).toBe('next')
  })
})

describe('overridden phase', () => {
  it('carries the bypassed check and the override wording', () => {
    const v = verdictFor({
      phase: phase(SEQ.loading, { status: 'overridden', completed_at: '2026-10-13T08:00:00Z' }),
      checks: [check('bypassed', 'not_checked', 'Checks bypassed')],
    })

    expect(v).toMatchObject({ outcome: 'overridden', headline: 'Closed by dispatcher override', nodeType: 'done' })
    expect(v?.reasons).toEqual(['Checks did not run'])
  })
})

describe('null verdicts', () => {
  it('has none for trip_creation', () => {
    expect(verdictFor({ phase: phase(SEQ.creation, COMPLETED) })).toBeNull()
  })

  it('has none for an unresolved phase on a cancelled trip', () => {
    expect(verdictFor({ phase: phase(SEQ.departure), isActive: true, tripStatus: 'cancelled' })).toBeNull()
  })

  it('still judges a resolved phase on a cancelled trip', () => {
    expect(verdictFor({ phase: phase(SEQ.loading, COMPLETED), checks: PASSES, tripStatus: 'cancelled' })?.outcome).toBe('clean')
  })
})

describe('"Clean" is not a word we use (D44)', () => {
  it('appears in no headline or reason of any outcome', () => {
    const resolved = phase(SEQ.loading, COMPLETED)
    const verdicts = [
      verdictFor({ phase: resolved, checks: PASSES }),
      verdictFor({ phase: resolved, checks: [check('truck_geofence', 'not_checked')] }),
      verdictFor({ phase: resolved, checks: PASSES, exceptions: [exception('reviewed')] }),
      verdictFor({ phase: resolved, checks: [check('parcels', 'flag')] }),
      verdictFor({ phase: phase(SEQ.loading, { status: 'overridden' }) }),
      verdictFor({ phase: phase(SEQ.departure), isActive: true }),
      verdictFor({ phase: phase(SEQ.departure), isActive: true, actCounts: { uploads: 1 } }),
    ]

    const text = verdicts.flatMap(v => (v ? [v.headline, ...v.reasons] : [])).join(' | ')

    expect(text).not.toMatch(/clean/i)
    expect(verdicts.map(v => v?.outcome)).toEqual<(PhaseOutcome | undefined)[]>(
      ['clean', 'unverified', 'reviewed', 'attention', 'overridden', 'current', 'in_progress'],
    )
  })
})

describe('in_transit leg (D29, D41)', () => {
  const seal = check('seal_inspection', 'not_checked', 'Seal not inspected yet')
  const active = (over: Partial<PhaseVerdictInput> = {}) => verdictFor({
    phase: phase(SEQ.transit), checks: [seal], isActive: true,
    leg: { departedAt: DEPARTED_AT, arrivedAt: null }, ...over,
  })
  const resolved = (over: Partial<PhaseVerdictInput> = {}, arrivedAt = '2026-10-13T07:40:00Z') => verdictFor({
    phase: phase(SEQ.transit, { status: 'completed', completed_at: arrivedAt }),
    checks: [{ ...seal, title: 'Seal not inspected in transit' }],
    leg: { departedAt: DEPARTED_AT, arrivedAt }, ...over,
  })

  it('an active leg with no exceptions is in progress, with a labelled departure and a live duration', () => {
    const v = active()

    expect(v?.outcome).toBe('in_progress')
    expect(v?.reasons).toEqual(['Departed 09:00 SAST', '3\u00a0h\u00a012\u00a0m on the road'])
  })

  it('an active leg with one unreviewed exception needs attention', () => {
    const v = active({ exceptions: [exception('needs_review', 'route_deviation'), exception('reviewed', 'tracker_silent', 'info', 'exc-2')] })

    expect(v?.outcome).toBe('attention')
    expect(v?.reasons).toEqual(['2 exceptions en route, 1 needs review', 'Departed 09:00 SAST', '3\u00a0h\u00a012\u00a0m on the road'])
    expect(v?.nodeType).toBe('warn')
  })

  it('agrees the verb for several unreviewed exceptions', () => {
    const v = active({ exceptions: [exception('needs_review'), exception('needs_review', 'tracker_silent', 'warning', 'exc-2')] })

    expect(v?.reasons[0]).toBe('2 exceptions en route, 2 need review')
  })

  it('never awards clean to an active leg with no checks that can pass', () => {
    expect(active()?.outcome).not.toBe('clean')
  })

  it('a finished leg with no exceptions is unverified "No exceptions recorded", never clean (D29)', () => {
    const v = resolved()

    expect(v?.outcome).toBe('unverified')
    expect(v?.headline).toBe('No exceptions recorded')
    expect(v?.reasons).toEqual(['Departed 09:00 SAST', '40\u00a0min on the road'])
  })

  it('stays unverified even if a caller hands it passing checks', () => {
    const v = resolved({ checks: [check('truck_geofence', 'pass')] })

    expect(v?.outcome).toBe('unverified')
  })

  it('a finished leg with every exception reviewed is reviewed', () => {
    const v = resolved({ exceptions: [exception('reviewed')] }, '2026-10-13T07:55:00Z')

    expect(v?.outcome).toBe('reviewed')
    expect(v?.reasons).toEqual(['1 exception en route, 0 need review', 'Departed 09:00 SAST', '55\u00a0min on the road'])
  })

  it('a finished leg with an unreviewed exception needs attention', () => {
    const v = resolved({ exceptions: [exception('needs_review')] })

    expect(v?.outcome).toBe('attention')
    expect(v?.reasons).toEqual(['1 exception en route, 1 needs review', 'Departed 09:00 SAST', '40\u00a0min on the road'])
  })

  it('stops the clock at arrival: a resolved leg uses completed_at, not now', () => {
    const v = resolved({ nowMs: NOW_MS + 5 * 60 * 60 * 1000 }, '2026-10-13T09:12:00Z')

    expect(v?.reasons.join(' ')).toContain('2\u00a0h\u00a012\u00a0m on the road')
  })

  it('omits the duration of a finished leg that has no arrival time instead of ticking on', () => {
    const v = verdictFor({
      phase: phase(SEQ.transit, { status: 'completed', completed_at: null }),
      leg: { departedAt: DEPARTED_AT, arrivedAt: null },
    })

    expect(v?.reasons.join(' ')).not.toContain('on the road')
  })

  it('omits both "Departed" and the duration when the departure time is unknown', () => {
    const v = active({ leg: { departedAt: null, arrivedAt: null } })

    expect(v?.reasons.join(' ')).not.toMatch(/Departed|on the road/)
    expect(v?.reasons.length).toBeGreaterThan(0)
  })

  it('omits the duration of an unfinished leg whose departure is unparseable', () => {
    const v = active({ leg: { departedAt: 'not-a-date', arrivedAt: null } })

    expect(v?.reasons.join(' ')).not.toMatch(/NaN|Departed|on the road/)
  })

  it('never shows a negative duration when the clock runs backwards', () => {
    const v = active({ nowMs: Date.parse(DEPARTED_AT) - 60 * 60 * 1000 })

    const text = v?.reasons.join(' ') ?? ''
    expect(text).not.toMatch(/-\d|NaN/)
    expect(text).not.toContain('on the road')
  })

  it.each([
    [0, '0 min'], [59 * 60 * 1000, '59 min'], [60 * 60 * 1000, '1 h 00 m'], [65 * 60 * 1000, '1 h 05 m'], [26 * 60 * 60 * 1000 + 7 * 60 * 1000, '26 h 07 m'],
  ])('formats %i ms on the road as %s', (elapsedMs, expected) => {
    const v = active({ nowMs: Date.parse(DEPARTED_AT) + elapsedMs })

    expect(v?.reasons).toContain(`${expected.replaceAll(' ', '\u00a0')} on the road`)
  })

  it('an overridden leg is overridden without a duration', () => {
    const v = verdictFor({
      phase: phase(SEQ.transit, { status: 'overridden', completed_at: '2026-10-13T08:00:00Z' }),
      checks: [check('bypassed', 'not_checked', 'Checks bypassed')],
      leg: { departedAt: DEPARTED_AT, arrivedAt: '2026-10-13T08:00:00Z' },
    })

    expect(v?.outcome).toBe('overridden')
    expect(v?.reasons.join(' ')).not.toContain('on the road')
  })
})

describe('CONFIRM_VERBS', () => {
  it('is the one per-phase verb table, shared with the Recorded rail wording', () => {
    expect(CONFIRM_VERBS.confirmation).toBe('delivery')
    expect(CONFIRM_VERBS.activation).toBe('arrival')
    expect(CONFIRM_VERBS.in_transit).toBe('arrival')
  })
})

describe('PhaseVerdict.reviewed', () => {
  const resolvedLoading = (): PhaseDescriptor => ({ ...SINGLE_LEG_PHASE_PLAN.find(p => p.phase_type === 'loading')!, status: 'completed', completed_at: '2026-01-01T10:00:00Z' })
  const exceptionWith = (id: string, review_status: ExceptionReviewStatus): TripException => ({
    id: id as ExceptionId, trip_id: 't', exception_type: 'cargo_damage', source: 'driver', severity: 'info', description: 'd',
    phase_event_id: null, checkpoint_id: null, supporting_artifact_id: null, review_status, review_outcome: null,
    reviewed_by_user_id: null, reviewed_at: null, review_note: null, contact_method: null, vehicle_id: null, merkle_batch_id: null,
    claimed_by_user_id: null, claimed_at: null, claimed_by_name: null, reviewed_by_name: null, created_at: '2026-01-01T10:00:00Z', updated_at: '2026-01-01T10:00:00Z',
  })
  const verdictFor = (exceptions: TripException[]): PhaseVerdict | null => phaseVerdict({
    phase: resolvedLoading(), checks: [], exceptions, actCounts: { uploads: 0 }, isActive: false, tripStatus: 'closed', leg: null, nowMs: 0,
  })

  it('is true only when every exception was reviewed', () => {
    expect(verdictFor([exceptionWith('a', 'reviewed')])?.reviewed).toBe(true)
    expect(verdictFor([exceptionWith('a', 'reviewed'), exceptionWith('b', 'reviewed')])?.reviewed).toBe(true)
  })

  it('is not set for a merely recorded exception, so no consumer has to read the headline', () => {
    const verdict = verdictFor([exceptionWith('a', 'recorded')])

    expect(verdict?.outcome).toBe('reviewed')
    expect(verdict?.reviewed).toBeFalsy()
    expect(verdictFor([exceptionWith('a', 'reviewed'), exceptionWith('b', 'recorded')])?.reviewed).toBeFalsy()
  })

  it('is not set on any other outcome', () => {
    expect(verdictFor([])?.reviewed).toBeFalsy()
    expect(verdictFor([exceptionWith('a', 'needs_review')])?.reviewed).toBeFalsy()
  })
})
