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
// Two levels up — the fixture lives in components/phase/__tests__/, not steps/__tests__/.
import { makePhase } from '../../__tests__/testFixtures'
import { LoadingStep } from '@/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient'
import type { Trip } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseEventId } from '@shared/lib/types/phase'

// vi.hoisted, not a plain top-level const: vi.mock factories below are hoisted above
// every import and top-level statement in this file, so a factory that closed over an
// ordinary `const linehaul` here would read it before initialization.
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

// Bare draft — every test below that doesn't care about the photo state renders with no
// captured photo yet, matching what LOADING_INITIAL seeds a fresh step with.
const EMPTY_DRAFT = { linehaulPhotoDataUrl: null, linehaulPhotoArtifactId: null, capturedAt: null }

// The blocked branch now renders WarehouseWaitCard (components/phase/WarehouseWaitCard.tsx),
// which reads useTrip() directly — every test in this file renders Linehaul bare, with no
// TripProvider ancestor, so the real hook (which throws outside one) is stubbed for the
// whole file. A single module-scope vi.fn(), not one created per render, so the "Check now"
// tests below can assert on it after the click.
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

    // The theft-risk rule: the driver must never learn what is in the truck.
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

  // Task: driver PWA trip auto-refresh (2026-08-10) — the blocked wait is no longer a
  // dead end. WarehouseWaitCard adds a Check now control alongside the existing copy.
  it('renders a Check now control when blocked', () => {
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

  it('activating Check now calls refreshQuietly', () => {
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

    // "Linehaul sheet" also appears in the StepHeader's phase name, so the capture
    // control is identified by its own copy instead — unique to CameraCapture.
    expect(screen.getByText(/tap to photograph/i)).toBeInTheDocument()
  })

  it('disables the swipe until a photo exists', () => {
    // SwipeToConfirm renders role="slider" (a draggable track), not a <button>, unless
    // the tap-to-confirm preference is on — mirrors the pattern in
    // departure/__tests__/CaptureSeal.test.tsx.
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

    expect(screen.getByRole('slider', { name: 'Confirm linehaul' })).toHaveAttribute('aria-disabled', 'true')

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

    expect(screen.getByRole('slider', { name: 'Confirm linehaul' })).toHaveAttribute('aria-disabled', 'false')
  })
})

// ─── Step 4c: prove the wiring, not just the component ─────────────────────────────
//
// LoadingStep (PhaseStepPageClient.tsx) unconditionally calls usePhaseStepController,
// which itself calls useRouter, useToast, useOfflineQueue, useTrip and useLocationTrail —
// none of those are optional, so rendering LoadingStep at all means mocking all five
// (Toast/Trip's real hooks throw outside their Providers by design). That is over the
// ~4-module threshold the task calls "awkward" — so rather than also depend on
// Linehaul.tsx's own markup/copy (already covered by the isolated tests above), the
// registry is mocked to a PROBE component that renders only what this test cares about:
// whether LoadingStep forwards a real `linehaul` prop. What is NOT faked is the thing the
// task exists to guard — LoadingStep's own fetchLinehaul call and the renderStep prop
// hand-off through the ComponentType<never> cast.
vi.mock('next/navigation', () => ({
  useParams: () => ({ type: 'loading', slug: '1-linehaul' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock('@/lib/hooks/useToast', () => ({ useToast: () => ({ notify: vi.fn() }) }))
vi.mock('@/lib/hooks/useOfflineQueue', () => ({ useOfflineQueue: () => ({ enqueuePhase: vi.fn() }) }))
vi.mock('@/lib/hooks/useLocationTrail', () => ({
  useLocationTrail: () => ({ capturePosition: vi.fn(async () => null), recordHere: vi.fn() }),
}))
// useTrip is already mocked once, near the top of this file (shared with the isolated
// Linehaul/WarehouseWaitCard tests above) — that mock already covers every field
// LoadingStep's usePhaseStepController reads (refetchTrip/adoptTrip/markPhaseSyncing/
// clearPhaseSyncing), so it is not redeclared here.
vi.mock('@/lib/api/manifest', () => ({
  fetchLinehaul: vi.fn().mockResolvedValue(linehaul),
}))
vi.mock('@/components/phase/steps/registry', () => ({
  stepComponentFor: (phaseType: string, slug: string) => {
    if (phaseType !== 'loading' || slug !== '1-linehaul') return undefined
    // The probe: renders only the one field this test checks LoadingStep actually
    // supplied, ignoring every other prop in the bag (draft, onUpdate, onComplete, ...).
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
    order_number: 'ORD-1',
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
    // Guards the ComponentType<never> cast in renderStep: a missing prop at that call site
    // is invisible to TypeScript, so only a render through LoadingStep can catch it.
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
