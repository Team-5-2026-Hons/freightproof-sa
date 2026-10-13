import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'
import type { PhaseDescriptor } from '@shared/lib/types/phase'
import type { TripException } from '@shared/lib/types/exception'
import { fmtDateTime } from '@shared/lib/utils/datetime'
import type { AbsentAct, AnchorAct, CompletionAct, EvidenceAct, ExceptionAct, ExpectedAct, MilestoneAct, PhaseAct } from '@/lib/phase/acts'
import { PhaseActs, type PhaseActsProps } from '../PhaseActs'
import { makePhase } from './testFixtures'
import { line } from './textLine'

const forensic = vi.hoisted(() => ({ canViewForensics: true, forensicOn: false, toggle: vi.fn() }))
vi.mock('@/lib/context/ForensicModeContext', () => ({ useForensicMode: () => forensic }))

const TAKEN = '2026-01-01T10:00:00Z'

function artifact(id: string, overrides: Partial<EvidenceArtifactWithUrl> = {}): EvidenceArtifactWithUrl {
  return {
    id: id as EvidenceArtifactWithUrl['id'], trip_id: 'trip-1', artifact_type: 'photo', s3_key: 'k', s3_bucket: 'b',
    file_hash: 'f'.repeat(64), mime_type: 'image/jpeg', captured_at: TAKEN, captured_by_driver_id: 'driver-1',
    captured_by_user_id: null, captured_lat: null, captured_lng: null, created_at: TAKEN, phase_event_id: 'phase-event-1',
    evidence_role: 'seal_photo', signed_url: `https://example.test/${id}.jpg`, ...overrides,
  }
}

function evidenceAct(id: string, overrides: Partial<EvidenceAct> = {}): EvidenceAct {
  return {
    kind: 'evidence', key: `phase-event-1:evidence:${id}`, role: 'seal_photo', artifactId: id, provenance: 'driver',
    state: 'submitted', metadataAvailable: true, takenAt: TAKEN, receivedAt: TAKEN, receivedAfterCancellation: false,
    ...overrides,
  }
}

function completionAct(overrides: Partial<CompletionAct> = {}): CompletionAct {
  return {
    kind: 'completion', key: 'phase-event-1:completion', outcome: 'completed', confirmedAt: TAKEN, recordedAt: TAKEN,
    values: { sealNumber: null, sealCondition: null, parcelsScanned: null, driverVisualCount: null }, override: null,
    ...overrides,
  }
}

function exceptionRecord(id: string, overrides: Partial<TripException> = {}): TripException {
  return {
    id: id as TripException['id'], trip_id: 'trip-1', exception_type: 'route_deviation', source: 'system', severity: 'warning',
    description: `Description ${id}`, phase_event_id: 'phase-event-1', checkpoint_id: null, supporting_artifact_id: null,
    review_status: 'needs_review', review_outcome: null, reviewed_by_user_id: null, reviewed_at: null, review_note: null,
    contact_method: null, vehicle_id: null, merkle_batch_id: null, claimed_by_user_id: null, claimed_at: null,
    claimed_by_name: null, reviewed_by_name: null, created_at: TAKEN, updated_at: TAKEN, ...overrides,
  }
}

function exceptionAct(id: string): ExceptionAct {
  return { kind: 'exception', key: `phase-event-1:exception:${id}`, exceptionId: id, at: TAKEN }
}

function props(acts: readonly PhaseAct[], overrides: Partial<PhaseActsProps> = {}): PhaseActsProps {
  const exceptions = acts.filter((a): a is ExceptionAct => a.kind === 'exception').map(a => exceptionRecord(a.exceptionId))
  return {
    acts,
    phase: makePhase('departure'),
    stopName: 'Cape Town Depot',
    destinationName: 'Johannesburg Depot',
    expectedArrivalAt: null,
    exceptionsById: new Map(exceptions.map(e => [e.id, e])),
    lookup: { artifactsById: new Map(), artifactLoading: false, artifactError: null, onRetryArtifacts: vi.fn() },
    visibleExceptionIds: new Set(exceptions.map(e => e.id)),
    hiddenExceptionCount: 0,
    live: false,
    selectedExceptionId: null,
    highlightedExceptionId: null,
    onOpenException: vi.fn(),
    ...overrides,
  }
}

function lookupWith(artifacts: EvidenceArtifactWithUrl[]): PhaseActsProps['lookup'] {
  return { artifactsById: new Map(artifacts.map(a => [a.id, a])), artifactLoading: false, artifactError: null, onRetryArtifacts: vi.fn() }
}

beforeEach(() => {
  forensic.canViewForensics = true
  forensic.forensicOn = false
})

describe('PhaseActs: the Recorded rail', () => {
  it('renders every act in the order given inside a Recorded region', () => {
    const acts: PhaseAct[] = [evidenceAct('a'), completionAct(), { kind: 'absent', key: 'k', role: 'waybill_photo' } satisfies AbsentAct]

    render(<PhaseActs {...props(acts, { lookup: lookupWith([artifact('a')]) })} />)

    const region = screen.getByRole('region', { name: 'Recorded' })
    const rows = within(region).getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0]).toHaveTextContent('Seal photographed')
    expect(rows[1]).toHaveTextContent('Driver confirmed departure')
    expect(rows[2]).toHaveTextContent('No waybill photo submitted at completion')
  })

  it('shows an uploaded photo with its state and the device clock, through EvidencePhoto', () => {
    const acts = [evidenceAct('a', { state: 'uploaded' })]

    render(<PhaseActs {...props(acts, { lookup: lookupWith([artifact('a')]) })} />)

    expect(screen.getByText('Uploaded')).toBeInTheDocument()
    expect(screen.getByText(`Taken ${fmtDateTime(TAKEN)} (device clock)`)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Seal photo' })).toHaveAttribute('src', 'https://example.test/a.jpg')
  })

  it('draws the photo as a 44 px thumbnail on the rail', () => {
    render(<PhaseActs {...props([evidenceAct('a')], { lookup: lookupWith([artifact('a')]) })} />)

    expect(screen.getByRole('img', { name: 'Seal photo' })).toHaveClass('w-11', 'h-11')
  })

  it('shows "Received" only when the server time is two minutes or more from the device time', () => {
    const acts = [evidenceAct('a', { receivedAt: '2026-01-01T10:20:00Z' }), evidenceAct('b', { receivedAt: '2026-01-01T10:00:30Z', role: 'waybill_photo' })]

    render(<PhaseActs {...props(acts, { lookup: lookupWith([artifact('a'), artifact('b')]) })} />)

    expect(screen.getAllByText(/^Received /)).toHaveLength(1)
  })

  it('still names a submitted photo whose metadata failed to load, and says so', () => {
    const acts = [evidenceAct('missing', { metadataAvailable: false, takenAt: null, receivedAt: null })]

    render(<PhaseActs {...props(acts)} />)

    expect(screen.getByText('Seal photographed')).toBeInTheDocument()
    expect(screen.getByText('Submitted at completion')).toBeInTheDocument()
    expect(screen.getByText('Time unavailable')).toBeInTheDocument()
    expect(screen.getByText('Recorded artifact unavailable')).toBeInTheDocument()
  })

  it('shows "Evidence lookup failed" with a Retry that calls the page\'s retry', () => {
    const onRetry = vi.fn()
    const acts = [evidenceAct('a')]
    const base = props(acts)

    render(<PhaseActs {...base} lookup={{ ...base.lookup, artifactError: 'boom', onRetryArtifacts: onRetry }} />)

    expect(screen.getByText(/Evidence lookup failed/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))
    expect(onRetry).toHaveBeenCalled()
  })

  it.each([
    ['uploaded', 'Uploaded'], ['submitted', 'Submitted at completion'], ['not_submitted', 'Not submitted'],
    ['after_close', 'Received after the phase closed'], ['trip_cancelled', 'Not submitted — trip cancelled'],
  ] as const)('words the %s state as "%s"', (state, wording) => {
    render(<PhaseActs {...props([evidenceAct('a', { state })], { lookup: lookupWith([artifact('a')]) })} />)

    expect(screen.getByText(wording)).toBeInTheDocument()
  })

  it('calls the receiver\'s artifact the receiver\'s confirmation only when it is attributed to the receiver', () => {
    const doc = artifact('sig', { artifact_type: 'document', mime_type: 'image/png', evidence_role: 'pod_signature' })
    const receiver = evidenceAct('sig', { role: 'pod_signature', provenance: 'receiver' })

    const { rerender } = render(<PhaseActs {...props([receiver], { phase: makePhase('confirmation'), lookup: lookupWith([doc]) })} />)
    expect(screen.getByText('Receiver confirmed delivery · Attestation image')).toBeInTheDocument()
    expect(screen.queryByText('Submitted as receiver confirmation')).not.toBeInTheDocument()

    rerender(<PhaseActs {...props([{ ...receiver, provenance: 'unknown' }], { phase: makePhase('confirmation'), lookup: lookupWith([doc]) })} />)
    expect(screen.getByText('Submitted as receiver confirmation')).toBeInTheDocument()
    expect(screen.queryByText(/Receiver confirmed delivery/)).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/ed25519/i)
  })

  it('groups several uploads for one role under "{n} photos uploaded" and collapses beyond the first', () => {
    const acts = [
      evidenceAct('a', { state: 'uploaded' }), evidenceAct('b', { state: 'uploaded' }), evidenceAct('c', { state: 'uploaded' }),
    ]

    render(<PhaseActs {...props(acts, { lookup: lookupWith([artifact('a'), artifact('b'), artifact('c')]) })} />)

    expect(screen.getByText(line('3 photos uploaded'))).toBeInTheDocument()
    expect(screen.getAllByRole('img')).toHaveLength(1)
    const more = screen.getByRole('button', { name: '+2 more' })
    expect(more).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(more)

    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(more).toHaveAttribute('aria-expanded', 'true')
  })

  it('shows no group header or "+n more" for a role with one upload', () => {
    render(<PhaseActs {...props([evidenceAct('a')], { lookup: lookupWith([artifact('a')]) })} />)

    expect(screen.queryByText(/photos uploaded/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /more/ })).not.toBeInTheDocument()
  })

  it('records the completion with its device and server clocks, values, and the override and who authorised it', () => {
    const completion = completionAct({
      outcome: 'overridden', recordedAt: '2026-01-01T12:00:00Z',
      values: { sealNumber: 'FP-7204', sealCondition: null, parcelsScanned: null, driverVisualCount: null },
      override: { note: 'Driver phone lost', authorisedBy: 'user-42' },
    })

    render(<PhaseActs {...props([completion])} />)

    expect(screen.getByText('Closed by dispatcher override')).toBeInTheDocument()
    expect(screen.getByText(line('Seal FP-7204'))).toBeInTheDocument()
    expect(screen.getByText('Driver phone lost')).toBeInTheDocument()
    expect(screen.getByText(line('Authorised by user-42'))).toBeInTheDocument()
    expect(screen.getByText(/Confirmed .*\(device clock\) · recorded .*\(server clock\)/)).toBeInTheDocument()
  })

  it('applies the numeric rule to seal numbers, counts and ids on the rail', () => {
    const completion = completionAct({
      outcome: 'overridden',
      values: { sealNumber: 'FP-7204', sealCondition: null, parcelsScanned: 7, driverVisualCount: 6 },
      override: { note: 'Phone lost', authorisedBy: 'user-42' },
    })
    const milestone: MilestoneAct = { kind: 'milestone', key: 'm', event: 'departed', at: TAKEN, sealNumber: 'FP-3456' }

    render(<PhaseActs {...props([milestone, completion])} />)

    expect(screen.getByText('FP-3456')).toHaveClass('tabular-nums', 'font-semibold')
    expect(screen.getByText('FP-7204')).toHaveClass('tabular-nums')
    expect(screen.getByText('user-42')).toHaveClass('tabular-nums')
    expect(screen.getByText('6')).toHaveClass('tabular-nums')
  })

  it('applies the numeric rule to the "{n} photos uploaded" and "+n more" counts, with 44 px targets', () => {
    const acts = ['a', 'b', 'c'].map(id => evidenceAct(id, { state: 'uploaded' }))

    render(<PhaseActs {...props(acts, { lookup: lookupWith([artifact('a'), artifact('b'), artifact('c')]) })} />)

    expect(screen.getByText('3')).toHaveClass('tabular-nums')
    expect(screen.getByRole('button', { name: '+2 more' })).toHaveClass('min-h-11')
    expect(screen.getByText('2')).toHaveClass('tabular-nums')
  })

  it('uses the stop and destination names the page resolved', () => {
    const transit: PhaseDescriptor = makePhase('in_transit')
    const milestone: MilestoneAct = { kind: 'milestone', key: 'm', event: 'departed', at: TAKEN, sealNumber: 'FP-6390' }

    render(<PhaseActs {...props([milestone, completionAct()], { phase: transit })} />)

    expect(screen.getByText('Departed Cape Town Depot')).toBeInTheDocument()
    expect(screen.getByText(line('Sealed FP-6390 at departure'))).toBeInTheDocument()
    expect(screen.getByText('Arrived Johannesburg Depot')).toBeInTheDocument()
  })

  it('shows expectations as dashed rows that never claim anything is missing', () => {
    const expected = (role: ExpectedAct['role'], reason: ExpectedAct['reason'], key: string): ExpectedAct => ({ kind: 'expected', key, role, reason })

    render(<PhaseActs {...props([expected('seal_photo', 'evidence', 'k1'), expected(null, 'driver_confirmation', 'k2')])} />)

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Expected: seal photo')
    expect(rows[1]).toHaveTextContent('Waiting for the driver to confirm departure')
    expect(rows[0]).toHaveAttribute('data-row-kind', 'expected')
    expect(screen.queryByText(/missing/i)).not.toBeInTheDocument()
  })

  it('shows the en-route expectation with the planned arrival', () => {
    const enRoute: ExpectedAct = { kind: 'expected', key: 'k', role: null, reason: 'en_route' }

    render(<PhaseActs {...props([enRoute], { phase: makePhase('in_transit'), expectedArrivalAt: '2026-01-01T16:00:00Z' })} />)

    expect(screen.getByText(/^En route to Johannesburg Depot · expected /)).toBeInTheDocument()
  })

  it('shows the anchor row only in forensic mode', () => {
    const anchor: AnchorAct = { kind: 'anchor', key: 'a', status: 'pending', consensusAt: null }
    const acts = [completionAct(), anchor]

    const { rerender } = render(<PhaseActs {...props(acts)} />)
    expect(screen.queryByText('Anchoring pending')).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)

    forensic.forensicOn = true
    rerender(<PhaseActs {...props(acts)} />)
    expect(screen.getByText('Anchoring pending')).toBeInTheDocument()
  })
})

describe('PhaseActs: exception rows', () => {
  it('renders each exception as one row in the rail, in place', () => {
    const acts: PhaseAct[] = [evidenceAct('a'), exceptionAct('e1'), completionAct()]

    render(<PhaseActs {...props(acts, { lookup: lookupWith([artifact('a')]) })} />)

    const rows = screen.getAllByRole('listitem')
    expect(rows[1]).toHaveTextContent('Route Deviation')
    expect(within(rows[1]!).getByRole('button')).toBeInTheDocument()
  })

  it('opens an exception from its row', async () => {
    const onOpen = vi.fn()
    render(<PhaseActs {...props([exceptionAct('e1')], { onOpenException: onOpen })} />)

    await userEvent.click(screen.getByRole('button', { name: /Route Deviation/ }))

    expect(onOpen).toHaveBeenCalledWith('e1', 'phase-event-1')
  })

  it('shows only the visible rows plus one "+n more" row that opens the phase in the panel', async () => {
    const onOpen = vi.fn()
    const acts = ['e1', 'e2', 'e3', 'e4', 'e5'].map(exceptionAct)

    render(<PhaseActs {...props(acts, { visibleExceptionIds: new Set(['e1', 'e2', 'e3']), hiddenExceptionCount: 2, onOpenException: onOpen })} />)

    expect(screen.getAllByRole('button', { name: /Route Deviation/ })).toHaveLength(3)
    await userEvent.click(screen.getByRole('button', { name: /\+2 more/ }))
    expect(onOpen).toHaveBeenCalledWith(null, 'phase-event-1')
  })

  it('marks the selected and highlighted rows', () => {
    render(<PhaseActs {...props([exceptionAct('e1'), exceptionAct('e2')], { selectedExceptionId: 'e1', highlightedExceptionId: 'e2' })} />)

    const [first, second] = screen.getAllByRole('button')
    expect(first).toHaveAttribute('aria-current', 'true')
    expect(second).toHaveAttribute('data-highlighted', 'true')
  })
})

describe('PhaseActs: highlight only when live', () => {
  it('highlights a row that arrives while the phase is live, then lets it fade', () => {
    vi.useFakeTimers()
    try {
      const first = evidenceAct('a', { state: 'uploaded' })
      const second = evidenceAct('b', { state: 'uploaded' })
      const lookup = lookupWith([artifact('a'), artifact('b')])
      const { rerender } = render(<PhaseActs {...props([first], { live: true, lookup })} />)
      expect(document.querySelector('[data-highlighted="true"]')).toBeNull()

      rerender(<PhaseActs {...props([first, second], { live: true, lookup })} />)
      expect(document.querySelectorAll('[data-highlighted="true"]')).toHaveLength(1)

      act(() => { vi.advanceTimersByTime(5000) })
      expect(document.querySelector('[data-highlighted="true"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not highlight a late upload or receipt on a phase that is not live', () => {
    const first = completionAct()
    const late = evidenceAct('late', { state: 'after_close' })
    const lookup = lookupWith([artifact('late')])
    const { rerender } = render(<PhaseActs {...props([first], { live: false, lookup })} />)

    rerender(<PhaseActs {...props([first, late], { live: false, lookup })} />)

    expect(screen.getByText('Received after the phase closed')).toBeInTheDocument()
    expect(document.querySelector('[data-highlighted="true"]')).toBeNull()
  })
})
