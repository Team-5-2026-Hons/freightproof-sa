// frontend/driver-pwa/components/phase/steps/__tests__/linehaul.test.tsx
//
// The Linehaul step under test in isolation (Step 1), plus a render through the real
// PhaseStepPageClient call site (Step 4c). The isolated tests alone are not sufficient:
// renderStep (PhaseStepPageClient.tsx) widens STEP_REGISTRY's ComponentType<never> back to
// the resolved component's real props via an `as unknown as` cast, so a step that needs a
// prop the call site forgets to pass compiles clean and renders blank — only a render
// through the actual LoadingStep function can catch that class of bug.
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { Linehaul } from '../loading/Linehaul'
import { makePhase } from '../../__tests__/testFixtures'
import { LoadingStep } from '@/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseEventId } from '@shared/lib/types/phase'

const { linehaul } = vi.hoisted(() => ({
  linehaul: {
    trip_id: 'trip-1',
    vehicle_registration: 'ABC123GP',
    vehicle_type: 'horse',
    driver_full_name: 'Test Driver',
    consolidated_unit_count: 4,
    origin_scan_complete: true,
    pulled_at: '2026-08-05T10:00:00Z',
  },
}))

const EMPTY_DRAFT = {
  linehaulPhotoDataUrl: null, linehaulPhotoArtifactId: null,
  linehaulPdfDataUrl: null, linehaulPdfArtifactId: null, capturedAt: null,
}

const mockRefreshQuietly = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => ({
    refetchTrip: vi.fn().mockResolvedValue(null),
    adoptTrip: vi.fn(),
    markPhaseSyncing: vi.fn(),
    clearPhaseSyncing: vi.fn(),
    refreshQuietly: mockRefreshQuietly,
    isRefreshing: false,
    lastRefreshedAt: null,
  }),
}))

beforeEach(() => {
  mockRefreshQuietly.mockClear()
})

describe('Linehaul', () => {
  it('shows the consolidated unit count', () => {
    render(
      <Linehaul
        tripId="trip-1"
        phase={makePhase('loading')}
        stepIndex={0}
        linehaul={linehaul}
        draft={EMPTY_DRAFT}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByText(/4/)).toBeInTheDocument()
  })

  it('never renders per-parcel data', () => {
    render(
      <Linehaul
        tripId="trip-1"
        phase={makePhase('loading')}
        stepIndex={0}
        linehaul={linehaul}
        draft={EMPTY_DRAFT}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.queryByText(/barcode/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/waybill no/i)).not.toBeInTheDocument()
  })

  it('renders a waiting state instead of the confirm control when blocked', () => {
    render(
      <Linehaul
        tripId="trip-1"
        phase={{ ...makePhase('loading'), blocked_on: 'warehouse_scan' }}
        stepIndex={0}
        linehaul={null}
        draft={EMPTY_DRAFT}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByText(/waiting for the warehouse/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument()
  })

  it('renders a Check Now control when blocked', () => {
    render(
      <Linehaul
        tripId="trip-1"
        phase={{ ...makePhase('loading'), blocked_on: 'warehouse_scan' }}
        stepIndex={0}
        linehaul={null}
        draft={EMPTY_DRAFT}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /check now/i })).toBeInTheDocument()
  })

  it('activating Check Now calls refreshQuietly', () => {
    render(
      <Linehaul
        tripId="trip-1"
        phase={{ ...makePhase('loading'), blocked_on: 'warehouse_scan' }}
        stepIndex={0}
        linehaul={null}
        draft={EMPTY_DRAFT}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /check now/i }))

    expect(mockRefreshQuietly).toHaveBeenCalledTimes(1)
  })

  it('renders the capture control in the non-blocked branch', () => {
    render(
      <Linehaul
        tripId="trip-1"
        phase={makePhase('loading')}
        stepIndex={0}
        linehaul={linehaul}
        draft={EMPTY_DRAFT}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /scan the sheet/i })).toBeInTheDocument()
  })

  it('disables the swipe until a photo exists', async () => {
    const { rerender } = render(
      <Linehaul
        tripId="trip-1"
        phase={makePhase('loading')}
        stepIndex={0}
        linehaul={linehaul}
        draft={EMPTY_DRAFT}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    expect(screen.getByRole('slider', { name: 'Confirm Linehaul' })).toHaveAttribute('aria-disabled', 'true')

    rerender(
      <Linehaul
        tripId="trip-1"
        phase={makePhase('loading')}
        stepIndex={0}
        linehaul={linehaul}
        draft={{ ...EMPTY_DRAFT, linehaulPhotoDataUrl: 'data:image/jpeg;base64,abc' }}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByRole('slider', { name: 'Confirm Linehaul' })).toHaveAttribute('aria-disabled', 'false'))
  })
})

vi.mock('next/navigation', () => ({
  useParams: () => ({ type: 'loading', slug: '1-linehaul' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
vi.mock('@/lib/hooks/useOfflineQueue', () => ({ useOfflineQueue: () => ({ enqueuePhase: vi.fn() }) }))
vi.mock('@/lib/hooks/useLocationTrail', () => ({
  useLocationTrail: () => ({ capturePosition: vi.fn(async () => null), recordHere: vi.fn() }),
}))
vi.mock('@/lib/api/manifest', () => ({
  fetchLinehaul: vi.fn().mockResolvedValue(linehaul),
}))
vi.mock('@/components/phase/steps/registry', () => ({
  stepComponentFor: (phaseType: string, slug: string) => {
    if (phaseType !== 'loading' || slug !== '1-linehaul') return undefined
    return function LinehaulProbe(props: { linehaul: typeof linehaul | null }) {
      return <p>{props.linehaul?.vehicle_registration ?? 'no-linehaul'}</p>
    }
  },
}))

const LOADING_PE = 'pe-loading-1' as PhaseEventId

function loadingPhase(): PhaseDescriptor {
  return makePhase('loading', { phase_event_id: LOADING_PE, blocked_on: null })
}

function loadingTrip(phase: PhaseDescriptor): Trip {
  return {
    id: 'trip-1' as unknown as Trip['id'],
    trip_reference: 'TRP-TEST-0001',
    pp_manifest: null,
    status: 'active',
    trip_type: 'loaded',
    journey_lock_hash: null,
    idvs_check_status: 'verified',
    origin_precinct_id: 'precinct-1',
    destination_precinct_id: 'precinct-2',
    stops: [],
    consignments: [],
    pulsit_trip_reference_id: null,
    planned_departure_at: null,
    actual_departure_at: null,
    planned_arrival_at: null,
    actual_arrival_at: null,
    closed_at: null,
    driver: null,
    horse: null,
    trailers: [],
    phases: [phase],
    current_phase: phase.phase_type,
    current_stop: null,
    exceptions: [],
    blockchain_receipts: [],
    warnings: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('LoadingStep wiring (PhaseStepPageClient)', () => {
  it('receives the linehaul document from the page client, not just from a test prop', async () => {
    const phase = loadingPhase()
    const trip = loadingTrip(phase)

    render(
      <LoadingStep
        trip={trip}
        phase={phase}
        slug="1-linehaul"
        stepIndex={0}
        isFinalStep
        onHandOff={vi.fn()}
      />,
    )

    await waitFor(() => expect(screen.getByText('ABC123GP')).toBeInTheDocument())
  })
})
