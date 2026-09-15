import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TransitJourneySummary } from './TransitJourneySummary'
import { makePhase } from '@/components/domain/__tests__/testFixtures'
import type { PhaseDescriptor, PhaseEventId } from '@shared/lib/types/phase'
import type { ExceptionId, ExceptionSeverity, TripException } from '@shared/lib/types/exception'
import type { EvidenceArtifactWithUrl } from '@shared/lib/types/evidence'

// Task 9: the summary is the ONE place a collapsed transit leg is allowed to say
// anything about departure/arrival — it must never claim more than the ledger
// actually recorded (no invented timestamp, no fabricated arrival on an override).

function departure(overrides: Partial<PhaseDescriptor> = {}): PhaseDescriptor {
  return makePhase('departure', {
    phase_event_id: 'departure-1' as PhaseEventId,
    sequence_number: 3,
    status: 'pending',
    completed_at: null,
    ...overrides,
  })
}

function transit(overrides: Partial<PhaseDescriptor> = {}): PhaseDescriptor {
  return makePhase('in_transit', {
    phase_event_id: 'transit-1' as PhaseEventId,
    sequence_number: 4,
    status: 'pending',
    completed_at: null,
    ...overrides,
  })
}

function makeException(overrides: Partial<TripException> & Pick<TripException, 'id' | 'phase_event_id' | 'severity'>): TripException {
  return {
    trip_id: 'trip-1',
    exception_type: 'route_deviation',
    source: 'system',
    description: 'Vehicle deviated from the planned route.',
    checkpoint_id: null,
    supporting_artifact_id: null,
    review_status: 'recorded',
    review_outcome: null,
    reviewed_by_user_id: null,
    reviewed_at: null,
    review_note: null,
    contact_method: null,
    vehicle_id: null,
    merkle_batch_id: null,
    created_at: '2026-01-01T10:00:00Z',
    updated_at: '2026-01-01T10:00:00Z',
    ...overrides,
  }
}

const noExceptions: readonly TripException[] = []

describe('TransitJourneySummary: leg state copy', () => {
  it('shows "Awaiting departure" and invents no timestamp when the leg has not departed', () => {
    const { container } = render(
      <TransitJourneySummary
        phase={transit()}
        allPhases={[departure(), transit()]}
        originName="Cape Town DC"
        destinationName="Durban DC"
        exceptions={noExceptions}
        onOpenExceptions={vi.fn()}
      />,
    )

    expect(screen.getByText(/Awaiting departure/)).toBeInTheDocument()
    expect(container.querySelector('time')).not.toBeInTheDocument()
  })

  it('shows "En route to <destination>" once the leg has departed but not arrived', () => {
    const dep = departure({ status: 'completed', completed_at: '2026-01-01T07:00:00Z' })
    const { container } = render(
      <TransitJourneySummary
        phase={transit()}
        allPhases={[dep, transit()]}
        originName="Cape Town DC"
        destinationName="Durban DC"
        exceptions={noExceptions}
        onOpenExceptions={vi.fn()}
      />,
    )

    expect(screen.getByText(/En route to Durban DC/)).toBeInTheDocument()
    expect(container.querySelector('time')).not.toBeInTheDocument()
  })

  it('shows the actual recorded arrival time on a completed leg', () => {
    const dep = departure({ status: 'completed', completed_at: '2026-01-01T07:00:00Z' })
    const arrivedTransit = transit({ status: 'completed', completed_at: '2026-01-01T12:00:00Z' })
    const { container } = render(
      <TransitJourneySummary
        phase={arrivedTransit}
        allPhases={[dep, arrivedTransit]}
        originName="Cape Town DC"
        destinationName="Durban DC"
        exceptions={noExceptions}
        onOpenExceptions={vi.fn()}
      />,
    )

    expect(screen.getByText(/Durban DC/)).toBeInTheDocument()
    const time = container.querySelector('time')
    expect(time).toBeInTheDocument()
    expect(time).toHaveAttribute('dateTime', '2026-01-01T12:00:00Z')
  })

  it('does not fabricate an arrival for an overridden leg that already departed', () => {
    // override_phase stamps completed_at even though nothing arrived (D4) — the
    // summary must not read that override timestamp as a real arrival.
    const dep = departure({ status: 'completed', completed_at: '2026-01-01T07:00:00Z' })
    const overridden = transit({ status: 'overridden', completed_at: '2026-01-01T09:00:00Z', dispatcher_override_note: 'Driver phone lost' })
    const { container } = render(
      <TransitJourneySummary
        phase={overridden}
        allPhases={[dep, overridden]}
        originName="Cape Town DC"
        destinationName="Durban DC"
        exceptions={noExceptions}
        onOpenExceptions={vi.fn()}
      />,
    )

    expect(screen.queryByText(/Arrived/)).not.toBeInTheDocument()
    expect(container.querySelector('time')).not.toBeInTheDocument()
    expect(screen.getByText(/En route to Durban DC/)).toBeInTheDocument()
  })

  it('does not fabricate an arrival for an overridden leg that never departed', () => {
    const overridden = transit({ status: 'overridden', completed_at: '2026-01-01T09:00:00Z', dispatcher_override_note: 'Driver phone lost' })
    const { container } = render(
      <TransitJourneySummary
        phase={overridden}
        allPhases={[departure(), overridden]}
        originName="Cape Town DC"
        destinationName="Durban DC"
        exceptions={noExceptions}
        onOpenExceptions={vi.fn()}
      />,
    )

    expect(screen.queryByText(/Arrived/)).not.toBeInTheDocument()
    expect(container.querySelector('time')).not.toBeInTheDocument()
    expect(screen.getByText(/Awaiting departure/)).toBeInTheDocument()
  })
})

describe('TransitJourneySummary: compact exception markers', () => {
  it('uses artifact captured_at for a marker time when available, otherwise created_at', () => {
    const artifactId = 'artifact-1'
    const capturedAt = '2026-01-01T06:30:00Z'
    const exceptionWithArtifact = makeException({
      id: 'exc-captured' as ExceptionId,
      phase_event_id: 'transit-1',
      supporting_artifact_id: artifactId,
      severity: 'warning' as ExceptionSeverity,
      created_at: '2026-01-01T08:00:00Z',
    })
    const exceptionWithoutArtifact = makeException({
      id: 'exc-recorded' as ExceptionId,
      phase_event_id: 'transit-1',
      severity: 'info' as ExceptionSeverity,
      created_at: '2026-01-01T09:00:00Z',
    })
    const artifact = {
      id: artifactId,
      captured_at: capturedAt,
    } as EvidenceArtifactWithUrl

    render(
      <TransitJourneySummary
        phase={transit()}
        allPhases={[departure(), transit()]}
        originName="Cape Town DC"
        destinationName="Durban DC"
        exceptions={[exceptionWithArtifact, exceptionWithoutArtifact]}
        onOpenExceptions={vi.fn()}
        artifactsById={new Map([[artifactId, artifact]])}
      />,
    )

    const markers = screen.getAllByTestId('transit-exception-marker')
    expect(markers[0].querySelector('time')).toHaveAttribute('dateTime', capturedAt)
    expect(markers[1].querySelector('time')).toHaveAttribute('dateTime', '2026-01-01T09:00:00Z')
  })

  it('renders one marker row per exception, in the given chronological order, with its own timestamp and label — plus a severity count per severity present', () => {
    const dep = departure({ status: 'completed', completed_at: '2026-01-01T07:00:00Z' })
    // Deliberately passed already in chronological order: the caller (TripTimeline)
    // owns sorting, this component only renders what it is given.
    const exceptions: TripException[] = [
      makeException({ id: 'exc-1' as ExceptionId, phase_event_id: 'transit-1', severity: 'critical' as ExceptionSeverity, exception_type: 'route_deviation', created_at: '2026-01-01T08:00:00Z' }),
      makeException({ id: 'exc-2' as ExceptionId, phase_event_id: 'transit-1', severity: 'warning' as ExceptionSeverity, exception_type: 'checkpoint_timeout', created_at: '2026-01-01T09:00:00Z' }),
      makeException({ id: 'exc-3' as ExceptionId, phase_event_id: 'transit-1', severity: 'warning' as ExceptionSeverity, exception_type: 'route_deviation', created_at: '2026-01-01T10:00:00Z' }),
    ]

    render(
      <TransitJourneySummary
        phase={transit()}
        allPhases={[dep, transit()]}
        originName="Cape Town DC"
        destinationName="Durban DC"
        exceptions={exceptions}
        onOpenExceptions={vi.fn()}
      />,
    )

    const markers = screen.getAllByTestId('transit-exception-marker')
    expect(markers).toHaveLength(3)
    // Asserted via the <time> element's dateTime attribute, not its formatted display
    // text — fmtDateTime renders in the runner's local timezone, so a literal "08:00"
    // substring check would be timezone-dependent flakiness, not a real assertion.
    expect(markers[0]).toHaveTextContent('Route Deviation')
    expect(markers[0].querySelector('time')).toHaveAttribute('dateTime', '2026-01-01T08:00:00Z')
    expect(markers[1]).toHaveTextContent('Checkpoint Timeout')
    expect(markers[1].querySelector('time')).toHaveAttribute('dateTime', '2026-01-01T09:00:00Z')
    expect(markers[2]).toHaveTextContent('Route Deviation')
    expect(markers[2].querySelector('time')).toHaveAttribute('dateTime', '2026-01-01T10:00:00Z')

    expect(screen.getByText('1 critical exception')).toBeInTheDocument()
    expect(screen.getByText('2 warning exceptions')).toBeInTheDocument()
    // Compact markers only — no description text, no artifacts, no full evidence card
    // this leg's exceptions would otherwise render as elsewhere in the timeline.
    expect(screen.queryByText('Vehicle deviated from the planned route.')).not.toBeInTheDocument()
  })

  it('derives both the marker rows and the severity counts from unique exception ids only', () => {
    const duplicate = makeException({ id: 'exc-dup' as ExceptionId, phase_event_id: 'transit-1', severity: 'critical' as ExceptionSeverity })

    render(
      <TransitJourneySummary
        phase={transit()}
        allPhases={[departure({ status: 'completed', completed_at: '2026-01-01T07:00:00Z' }), transit()]}
        originName="Cape Town DC"
        destinationName="Durban DC"
        exceptions={[duplicate, { ...duplicate }]}
        onOpenExceptions={vi.fn()}
      />,
    )

    expect(screen.getAllByTestId('transit-exception-marker')).toHaveLength(1)
    expect(screen.getByText('1 critical exception')).toBeInTheDocument()
  })

  it('gives the exceptions control an explicit, discoverable aria-label', () => {
    const exceptions: TripException[] = [
      makeException({ id: 'exc-1' as ExceptionId, phase_event_id: 'transit-1', severity: 'critical' as ExceptionSeverity }),
      makeException({ id: 'exc-2' as ExceptionId, phase_event_id: 'transit-1', severity: 'warning' as ExceptionSeverity }),
    ]

    render(
      <TransitJourneySummary
        phase={transit()}
        allPhases={[departure({ status: 'completed', completed_at: '2026-01-01T07:00:00Z' }), transit()]}
        originName="Cape Town DC"
        destinationName="Durban DC"
        exceptions={exceptions}
        onOpenExceptions={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'View exceptions for this leg (2)' })).toBeInTheDocument()
  })

  it('calls onOpenExceptions when the exceptions control is activated', () => {
    const onOpenExceptions = vi.fn()
    const exceptions: TripException[] = [
      makeException({ id: 'exc-1' as ExceptionId, phase_event_id: 'transit-1', severity: 'critical' as ExceptionSeverity }),
    ]

    render(
      <TransitJourneySummary
        phase={transit()}
        allPhases={[departure({ status: 'completed', completed_at: '2026-01-01T07:00:00Z' }), transit()]}
        originName="Cape Town DC"
        destinationName="Durban DC"
        exceptions={exceptions}
        onOpenExceptions={onOpenExceptions}
      />,
    )

    screen.getByRole('button', { name: /view exceptions/i }).click()
    expect(onOpenExceptions).toHaveBeenCalledTimes(1)
  })

  it('renders no marker rows and no exceptions control at all when there is nothing to open', () => {
    render(
      <TransitJourneySummary
        phase={transit()}
        allPhases={[departure(), transit()]}
        originName="Cape Town DC"
        destinationName="Durban DC"
        exceptions={noExceptions}
        onOpenExceptions={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryAllByTestId('transit-exception-marker')).toHaveLength(0)
  })
})

describe('TransitJourneySummary: repeated stop / same destination name across legs', () => {
  it('reads its own leg\'s state from its own phase id, not from the shared destination name', () => {
    // Two legs that both happen to name the same destination (a round trip back to
    // the same precinct) — the component must still describe THIS phase, identified
    // by its own phase_event_id, not by matching names.
    const leg1 = transit({ phase_event_id: 'leg-1' as PhaseEventId, status: 'completed', completed_at: '2026-01-01T12:00:00Z' })
    const leg2 = transit({ phase_event_id: 'leg-2' as PhaseEventId, sequence_number: 8, status: 'pending', completed_at: null })
    const dep2 = departure({ phase_event_id: 'dep-2' as PhaseEventId, sequence_number: 7, status: 'pending', completed_at: null })

    const { rerender, container } = render(
      <TransitJourneySummary
        phase={leg1}
        allPhases={[departure({ status: 'completed', completed_at: '2026-01-01T07:00:00Z' }), leg1]}
        originName="FedEx JHB"
        destinationName="FedEx JHB"
        exceptions={noExceptions}
        onOpenExceptions={vi.fn()}
      />,
    )
    expect(container.querySelector('time')).toHaveAttribute('dateTime', '2026-01-01T12:00:00Z')

    rerender(
      <TransitJourneySummary
        phase={leg2}
        allPhases={[dep2, leg2]}
        originName="FedEx JHB"
        destinationName="FedEx JHB"
        exceptions={noExceptions}
        onOpenExceptions={vi.fn()}
      />,
    )
    expect(screen.getByText(/Awaiting departure/)).toBeInTheDocument()
    expect(container.querySelector('time')).not.toBeInTheDocument()
  })
})
