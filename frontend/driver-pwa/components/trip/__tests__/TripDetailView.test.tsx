// frontend/driver-pwa/components/trip/__tests__/TripDetailView.test.tsx
//
// Rewritten for the phase model. The old version fixed every trip at exactly five
// handshakes and literally asserted "lists all five handshakes" — the fixed-length
// assumption the whole refactor exists to remove. This version renders against
// CROSS_DOCK_PHASE_PLAN (11 rows) and asserts N rows for an N-phase plan, so a
// reintroduced fixed-length assumption fails loudly instead of silently passing on a
// coincidentally-5-row fixture.
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, beforeAll } from 'vitest'
import { TripDetailView } from '../TripDetailView'
import { currentPhase } from '@/lib/phase'
import type { Trip, TripId } from '@shared/lib/types/trip'
import type { PhaseDescriptor, PhaseType } from '@shared/lib/types/phase'
import {
  SINGLE_LEG_PHASE_PLAN,
  CROSS_DOCK_PHASE_PLAN,
  makePhasePlan,
  type PlanStopInput,
} from '@shared/lib/mocks/phase-trips'

// TripDetailView renders SubpageHeader, which calls useRouter() internally for its
// router.back() fallback — stub it so the component mounts under jsdom without a real
// Next.js app router context (mirrors components/layout/__tests__/SubpageHeader.test.tsx).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

// jsdom does not implement scrollIntoView (a well-known jsdom gap, not an app bug —
// every real browser has it). PhaseProgressBar's useEffect calls it unconditionally
// on the current phase's cell, so any render with an unresolved current phase
// crashes with "scrollIntoView is not a function" unless this is stubbed.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

// Marks every phase up to and including `through` (by sequence_number) as completed —
// mirrors the identical local helper in lib/phase/__tests__/derive.test.ts.
function walk(plan: readonly PhaseDescriptor[], through: number): PhaseDescriptor[] {
  return plan.map((p) => (p.sequence_number <= through ? { ...p, status: 'completed' as const } : p))
}

function withEvidence(
  plan: readonly PhaseDescriptor[],
  phaseType: PhaseType,
  patch: Partial<PhaseDescriptor>,
): PhaseDescriptor[] {
  return plan.map((p) => (p.phase_type === phaseType ? { ...p, ...patch } : p))
}

function makeTrip(phases: PhaseDescriptor[], overrides: Partial<Trip> = {}): Trip {
  return {
    id: 'trip-1' as unknown as TripId,
    trip_reference: 'TRP-2026-0099',
    order_number: 'ORD-99',
    status: 'active',
    trip_type: 'loaded',
    journey_lock_hash: null,
    idvs_check_status: 'verified',
    origin_precinct_id: 'precinct-jhb',
    destination_precinct_id: 'precinct-dbn',
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
    phases,
    current_phase: null,
    current_stop: null,
    exceptions: [],
    blockchain_receipts: [],
    warnings: [],
    created_at: '2026-06-12T08:00:00Z',
    updated_at: '2026-06-12T08:00:00Z',
    ...overrides,
  }
}

// The "Phases" section's own row count — every mapped phase is a single top-level
// Card, so children.length minus the leading <h2>Phases</h2> is exactly the number of
// rendered rows. Avoids matching on PHASE_NAMES text, which repeats on a cross-dock
// plan (e.g. two "Unloading" rows) and so can't be counted with getAllByText alone.
function phasesSection(): HTMLElement {
  return screen.getByText('Phases').closest('section')!
}

describe('TripDetailView', () => {
  it('renders the trip reference, order number, and status chip regardless of variant', () => {
    render(
      <TripDetailView
        trip={makeTrip(SINGLE_LEG_PHASE_PLAN)}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={vi.fn()}
        showAllPhases={false}
      />,
    )

    expect(screen.getByRole('heading', { name: 'TRP-2026-0099' })).toBeInTheDocument()
    expect(screen.getByText('ORD-99')).toBeInTheDocument()
  })

  it('showAllPhases=true renders exactly N rows for an N-phase (11-row cross-dock) plan, only the current one tappable', () => {
    expect(CROSS_DOCK_PHASE_PLAN).toHaveLength(11)
    const onSelectPhase = vi.fn()
    const plan = walk(CROSS_DOCK_PHASE_PLAN, 4) // through the first in_transit leg
    const current = currentPhase(plan)!

    render(
      <TripDetailView
        trip={makeTrip(plan)}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={onSelectPhase}
        showAllPhases
      />,
    )

    const section = phasesSection()
    // -1 for the <h2>Phases</h2> heading itself.
    expect(section.children.length - 1).toBe(plan.length)

    const buttons = within(section).getAllByRole('button')
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0])
    expect(onSelectPhase).toHaveBeenCalledWith(expect.objectContaining({ phase_event_id: current.phase_event_id }))
  })

  it('resolves to the THIRD unloading occurrence (not the first) as the tappable row when the first two are complete', () => {
    // Synthetic 4-stop plan where every stop after the first drops off cargo, so
    // `unloading` occurs three times — mirrors lib/phase/__tests__/derive.test.ts's
    // own regression fixture for the same phase_type-repetition hazard, proving the
    // UI consumer (not just lib/phase's own derivation) resolves by sequence_number.
    const stops: PlanStopInput[] = [
      { trip_stop_id: 'stop-1', sequence: 1, picks_up: true, drops_off: false },
      { trip_stop_id: 'stop-2', sequence: 2, picks_up: false, drops_off: true },
      { trip_stop_id: 'stop-3', sequence: 3, picks_up: false, drops_off: true },
      { trip_stop_id: 'stop-4', sequence: 4, picks_up: false, drops_off: true },
    ]
    const fullPlan = makePhasePlan('trip-3x-unloading', stops, '2026-01-01T00:00:00Z', 'test-3u')
    const unloadingRows = fullPlan.filter((p) => p.phase_type === 'unloading')
    expect(unloadingRows).toHaveLength(3)

    const thirdUnloading = unloadingRows[2]
    const plan = walk(fullPlan, thirdUnloading.sequence_number - 1)
    const onSelectPhase = vi.fn()

    render(
      <TripDetailView
        trip={makeTrip(plan)}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={onSelectPhase}
        showAllPhases
      />,
    )

    fireEvent.click(within(phasesSection()).getAllByRole('button')[0])
    expect(onSelectPhase).toHaveBeenCalledWith(expect.objectContaining({ phase_event_id: thirdUnloading.phase_event_id }))
  })

  it('showAllPhases=false shows only the single current-phase card', () => {
    const onSelectPhase = vi.fn()
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 0) // trip_creation resolved — current is activation

    render(
      <TripDetailView
        trip={makeTrip(plan)}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={onSelectPhase}
        showAllPhases={false}
      />,
    )

    expect(screen.queryByText('Phases')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /activation/i }))
    expect(onSelectPhase).toHaveBeenCalledWith(expect.objectContaining({ phase_type: 'activation' }))
  })

  it('exception_hold suppresses the current-phase CTA and shows the hold notice (live view)', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 0)

    render(
      <TripDetailView
        trip={makeTrip(plan, { status: 'exception_hold' })}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={vi.fn()}
        showAllPhases={false}
      />,
    )

    expect(screen.getByText('Trip on hold')).toBeInTheDocument()
    // No phase CTA — submits while held can only 409.
    expect(screen.queryByRole('button', { name: /activation/i })).not.toBeInTheDocument()
  })

  it('exception_hold makes the current phase card non-tappable (showAllPhases)', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 0)

    render(
      <TripDetailView
        trip={makeTrip(plan, { status: 'exception_hold' })}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={vi.fn()}
        showAllPhases
      />,
    )

    expect(screen.getByText('Trip on hold')).toBeInTheDocument()
    expect(within(phasesSection()).queryAllByRole('button')).toHaveLength(0)
  })

  // The entry point to the driving screen keys on isDriving(), not on
  // `phase_type === 'in_transit'`. The old check could never fire on a real trip — the
  // backend closed the in_transit row the instant departure advanced, before driver-
  // submitted arrival existed — which is exactly what made the driving screen unreachable.
  it('shows the driving screen as the primary action while the truck is on the road', () => {
    const onInTransitHub = vi.fn()
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3) // departure resolved — in_transit pending, current
    expect(currentPhase(plan)?.phase_type).toBe('in_transit')

    render(
      <TripDetailView
        trip={makeTrip(plan)}
        onBack={vi.fn()}
        onInTransitHub={onInTransitHub}
        onSelectPhase={vi.fn()}
        showAllPhases={false}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /continue driving/i }))
    expect(onInTransitHub).toHaveBeenCalled()
  })

  it('replaces the arrival phase card with the driving entry while driving', () => {
    const onSelectPhase = vi.fn()
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3) // departure resolved — in_transit pending, current

    render(
      <TripDetailView
        trip={makeTrip(plan)}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={onSelectPhase}
        showAllPhases={false}
      />,
    )

    // The current phase's own capture card (in_transit carries no steps of its own, so
    // this would otherwise fall through to nothing useful) must not be offered while the
    // driver is moving — "Continue driving" takes its place instead.
    expect(screen.queryByRole('button', { name: /in transit/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue driving/i })).toBeInTheDocument()
  })

  it('shows the unloading capture card, not the driving screen, once arrival is recorded', () => {
    // in_transit resolved (arrival submitted), unloading current — the driver is standing
    // at the destination doing seal-verify. This is the state the old case-2 fossil (V7)
    // mistook for "still driving"; it must now show the arrival capture card instead.
    const onSelectPhase = vi.fn()
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 4) // through in_transit — arrival submitted
    expect(currentPhase(plan)?.phase_type).toBe('unloading')

    render(
      <TripDetailView
        trip={makeTrip(plan)}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={onSelectPhase}
        showAllPhases={false}
      />,
    )

    expect(screen.queryByRole('button', { name: /continue driving/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /unloading/i }))
    expect(onSelectPhase).toHaveBeenCalledWith(expect.objectContaining({ phase_type: 'unloading' }))
  })

  it('does not show the driving entry when the trip is not on the road', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 0) // current is activation

    render(
      <TripDetailView
        trip={makeTrip(plan)}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={vi.fn()}
        showAllPhases={false}
      />,
    )

    expect(screen.queryByRole('button', { name: /continue driving/i })).not.toBeInTheDocument()
  })

  it('shows the driving entry while in_transit is the unresolved current phase', () => {
    // With the backend keeping in_transit pending during the drive, isDriving returns
    // true while the driver is actively en route. This is exactly when the driving button
    // should appear to take them to the map and checkpoint/exception screens.
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3) // departure resolved — in_transit pending
    expect(currentPhase(plan)?.phase_type).toBe('in_transit')

    render(
      <TripDetailView
        trip={makeTrip(plan)}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={vi.fn()}
        showAllPhases={false}
      />,
    )

    expect(screen.getByRole('button', { name: /continue driving/i })).toBeInTheDocument()
  })

  it('a held trip shows the hold notice instead of the driving entry, even mid-leg', () => {
    // Genuinely mid-leg (in_transit pending, current) so this actually proves the hold
    // outranks driving, rather than the hold notice winning by coincidence because the
    // trip wasn't driving anyway.
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3)

    render(
      <TripDetailView
        trip={makeTrip(plan, { status: 'exception_hold' })}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={vi.fn()}
        showAllPhases={false}
      />,
    )

    expect(screen.getByText('Trip on hold')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /continue driving/i })).not.toBeInTheDocument()
  })

  it('shows an AnchorBadge "Anchored" chip on a completed, Hedera-anchored departure row (showAllPhases)', () => {
    const plan = withEvidence(walk(SINGLE_LEG_PHASE_PLAN, 3), 'departure', {
      event_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      blockchain_receipt_id: 'bcr-0099-departure',
    })

    render(
      <TripDetailView
        trip={makeTrip(plan)}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={vi.fn()}
        showAllPhases
      />,
    )

    expect(screen.getByText('Anchored')).toBeInTheDocument()
  })

  it('shows no anchored/anchoring copy when nothing in the plan has an event_hash yet', () => {
    const plan = walk(SINGLE_LEG_PHASE_PLAN, 3) // activation/loading/departure completed, none anchored

    render(
      <TripDetailView
        trip={makeTrip(plan)}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={vi.fn()}
        showAllPhases
      />,
    )

    expect(screen.queryByText('Anchored')).not.toBeInTheDocument()
    expect(screen.queryByText('Anchoring…')).not.toBeInTheDocument()
  })

  it('renders no "Evidence anchors" section in real-data mode even when a phase IS fully anchored', () => {
    // The section was removed deliberately: anchoring is a background process the driver
    // takes no action on, and a read-only pipeline row per anchored phase pushed the one
    // actionable card off a screen that has to fit in a single viewport. This asserts the
    // strongest version of that — fully anchored data present, section still absent — so
    // reinstating it fails here rather than quietly regrowing the screen.
    const plan = withEvidence(walk(SINGLE_LEG_PHASE_PLAN, 3), 'departure', {
      event_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
      blockchain_receipt_id: 'bcr-0099-departure',
    })

    render(
      <TripDetailView
        trip={makeTrip(plan)}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectPhase={vi.fn()}
        showAllPhases={false}
      />,
    )

    expect(screen.queryByText('Evidence anchors')).not.toBeInTheDocument()
    expect(screen.queryByText('Evidence hashed', { exact: false })).not.toBeInTheDocument()
    expect(screen.queryByText('Submitted to Hedera HCS')).not.toBeInTheDocument()
    expect(screen.queryByText(/Anchor receipt recorded/)).not.toBeInTheDocument()
  })

  it('back button in SubpageHeader calls onBack', () => {
    const onBack = vi.fn()
    render(
      <TripDetailView
        trip={makeTrip(SINGLE_LEG_PHASE_PLAN)}
        onBack={onBack}
        onInTransitHub={vi.fn()}
        onSelectPhase={vi.fn()}
        showAllPhases={false}
      />,
    )

    fireEvent.click(screen.getByText('← My Trips'))
    expect(onBack).toHaveBeenCalled()
  })
})
