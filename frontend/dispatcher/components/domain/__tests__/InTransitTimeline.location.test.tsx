import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { InTransitArrivalLocation, InTransitTimeline } from '../InTransitTimeline'
import { makePhase } from './testFixtures'
import type { PhaseEventId } from '@shared/lib/types/phase'
import type { ExceptionId, TripException } from '@shared/lib/types/exception'

const ORIGIN = 'Cape Town DC'
const DESTINATION = 'Paarl Depot'
const DEPARTED_AT = '2026-01-02T01:00:00Z'

// A completed departure phase that precedes the leg: the only source legDepartureAt
// is allowed to date the leg from (its own created_at is plan-generation time).
const departure = makePhase('departure', {
  phase_event_id: 'phase-event-departure' as PhaseEventId,
  sequence_number: 3,
  status: 'completed',
  completed_at: DEPARTED_AT,
})

function makeException(overrides: Partial<TripException> = {}): TripException {
  return {
    id: 'exc-1' as ExceptionId,
    trip_id: 'trip-1',
    exception_type: 'panic_button',
    source: 'driver',
    severity: 'critical',
    description: 'Driver reported feeling unsafe at a roadside stop.',
    phase_event_id: 'phase-event-1',
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
    created_at: '2026-01-02T02:00:00Z',
    updated_at: '2026-01-02T02:00:00Z',
    ...overrides,
  }
}

// The journey mini-timeline is the always-visible part of a transit row (TripTimeline
// renders it as persistentContent), so what it says about departure and arrival must
// be exactly what the ledger can prove: departure dated from the preceding departure
// phase, arrival from this leg's own completion, and an honest third state before
// either has happened.
describe('InTransitTimeline: journey nodes', () => {
  it('reads "Awaiting departure" and nothing else when no departure phase has completed', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', { sequence_number: 4, status: 'pending' })}
        allPhases={[makePhase('departure', { phase_event_id: 'd' as PhaseEventId, sequence_number: 3, status: 'pending' })]}
        exceptions={[]}
        originName={ORIGIN}
        destinationName={DESTINATION}
      />,
    )

    expect(screen.getByText(`Awaiting departure from ${ORIGIN}`)).toBeInTheDocument()
    expect(screen.queryByText(/Departed/)).not.toBeInTheDocument()
    expect(screen.queryByText(/En route to/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Arrived/)).not.toBeInTheDocument()
  })

  it('shows Departed then En route for an active leg, dated from the preceding departure', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', { sequence_number: 4, status: 'pending' })}
        allPhases={[departure]}
        exceptions={[]}
        originName={ORIGIN}
        destinationName={DESTINATION}
      />,
    )

    expect(screen.getByText(`Departed ${ORIGIN}`)).toBeInTheDocument()
    expect(screen.getByText(`En route to ${DESTINATION}`)).toBeInTheDocument()
    expect(screen.queryByText(/Arrived/)).not.toBeInTheDocument()
  })

  it('shows Departed then Arrived for a completed leg', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', { sequence_number: 4, status: 'completed', completed_at: '2026-01-02T04:00:00Z' })}
        allPhases={[departure]}
        exceptions={[]}
        originName={ORIGIN}
        destinationName={DESTINATION}
      />,
    )

    expect(screen.getByText(`Departed ${ORIGIN}`)).toBeInTheDocument()
    expect(screen.getByText(`Arrived ${DESTINATION}`)).toBeInTheDocument()
    expect(screen.queryByText(/En route to/)).not.toBeInTheDocument()
  })

  it('never reads an override timestamp as an arrival', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', { sequence_number: 4, status: 'overridden', completed_at: '2026-01-02T04:00:00Z' })}
        allPhases={[departure]}
        exceptions={[]}
        originName={ORIGIN}
        destinationName={DESTINATION}
      />,
    )

    expect(screen.queryByText(/Arrived/)).not.toBeInTheDocument()
    expect(screen.getByText(`En route to ${DESTINATION}`)).toBeInTheDocument()
  })

  it('places exception markers between departure and arrival, as compact label + severity, without the full card', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', { sequence_number: 4, status: 'completed', completed_at: '2026-01-02T04:00:00Z' })}
        allPhases={[departure]}
        exceptions={[makeException()]}
        originName={ORIGIN}
        destinationName={DESTINATION}
      />,
    )

    const marker = screen.getByTestId('transit-exception-marker')
    expect(within(marker).getByText('Panic Button')).toBeInTheDocument()
    expect(within(marker).getByText('Critical')).toBeInTheDocument()
    // The description, source and review link belong to the full card in the phase's
    // exception branch; repeating them here would be the duplication task 9 removed.
    expect(screen.queryByText('Driver reported feeling unsafe at a roadside stop.')).not.toBeInTheDocument()
    const labels = screen.getAllByText(/Departed|Panic Button|Arrived/).map(node => node.textContent)
    expect(labels[0]).toContain('Departed')
    expect(labels[labels.length - 1]).toContain('Arrived')
  })

  // This leg must never claim a continuous live route or invent a specific future
  // integration (weighbridges, checkpoints) — the generic absence line is the honest one.
  it('shows the generic honest-absence line rather than naming a specific future integration', () => {
    render(
      <InTransitTimeline
        phase={makePhase('in_transit', { sequence_number: 4, status: 'completed', completed_at: '2026-01-02T04:00:00Z' })}
        allPhases={[departure]}
        exceptions={[]}
        originName={ORIGIN}
        destinationName={DESTINATION}
      />,
    )

    expect(screen.getByText('Only recorded journey events are shown.')).toBeInTheDocument()
    expect(screen.queryByText(/Pulsit integration/)).not.toBeInTheDocument()
  })
})

// Task 3: the arrival fix is shown, but the ABSENCE of a destination verdict is the
// required behaviour: an in-transit leg's stop is its ORIGIN, so drawing a boundary
// against an arrival fix would compare it to the wrong fence (see the brief's binding
// rule). Kept behind the card's disclosure, separate from the journey above.
describe('InTransitArrivalLocation: recorded location at arrival', () => {
  it('renders nothing when no fix was recorded', () => {
    const { container } = render(
      <InTransitArrivalLocation phase={makePhase('in_transit', { status: 'completed', completed_at: '2026-01-02T00:00:00Z' })} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('shows the heading and the explicit no-verdict line, with no boundary, when a driver fix was recorded', () => {
    render(
      <InTransitArrivalLocation
        phase={makePhase('in_transit', {
          status: 'completed',
          completed_at: '2026-01-02T00:00:00Z',
          driver_phone_lat: -33.9249,
          driver_phone_lng: 18.4241,
        })}
      />,
    )

    expect(screen.getByText('Recorded location at arrival')).toBeInTheDocument()
    expect(screen.getByText('Truck precinct check unavailable for transit legs')).toBeInTheDocument()
    expect(screen.getByText('No boundary recorded for this phase')).toBeInTheDocument()
  })

  // A stored verdict always wins, even on a transit leg (verdictFor's documented rule).
  it('honours a stored verdict on a transit leg rather than forcing the transit default', () => {
    render(
      <InTransitArrivalLocation
        phase={makePhase('in_transit', {
          status: 'completed',
          completed_at: '2026-01-02T00:00:00Z',
          driver_phone_lat: -33.9249,
          driver_phone_lng: 18.4241,
          pulsit_geofence_confirmed: true,
        })}
      />,
    )

    expect(screen.getByText('Recorded location at arrival')).toBeInTheDocument()
    expect(screen.getByText('Truck within precinct tolerance')).toBeInTheDocument()
  })
})
