// frontend/driver-pwa/components/trip/__tests__/TripDetailView.test.tsx
import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { TripDetailView } from '../TripDetailView'
import type { Trip, TripId, TripStatus } from '@shared/lib/types/trip'
import type { HandshakeEvent, HandshakeEventId, HandshakeNumber, HandshakeStatus } from '@shared/lib/types/handshake'

// TripDetailView renders SubpageHeader, which calls useRouter() internally for its
// router.back() fallback — stub it so the component mounts under jsdom without a real
// Next.js app router context (mirrors components/layout/__tests__/SubpageHeader.test.tsx).
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}))

function makeHandshake(
  seq: HandshakeNumber,
  status: HandshakeStatus,
  overrides: Partial<Pick<HandshakeEvent, 'event_hash' | 'blockchain_receipt_id'>> = {},
): HandshakeEvent {
  return {
    id: `he-${seq}` as unknown as HandshakeEventId,
    trip_id: 'trip-1',
    handshake_type: 'origin_gate_in',
    sequence_number: seq,
    status,
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: null, driver_phone_lng: null, horse_gps_lat: null, horse_gps_lng: null,
    pulsit_geofence_confirmed: null, seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: null, pod_photo_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null, completed_at: null,
    created_at: '2026-06-12T09:00:00Z', updated_at: '2026-06-12T09:00:00Z',
    ...overrides,
  }
}

// H1-H2 completed, H3 in progress (current), H4-H5 upcoming — a representative
// in-flight trip that exercises both the "current" and "upcoming" render paths.
function makeTrip(status: TripStatus = 'origin_gate_out'): Trip {
  return {
    id: 'trip-1' as unknown as TripId,
    trip_reference: 'TRP-2026-0099',
    order_number: 'ORD-99',
    status,
    journey_lock_hash: null,
    idvs_check_status: 'verified',
    origin_precinct_id: 'precinct-jhb',
    destination_precinct_id: 'precinct-dbn',
    pulsit_trip_reference_id: null,
    planned_departure_at: null, actual_departure_at: null,
    planned_arrival_at: null, actual_arrival_at: null,
    closed_at: null,
    stops: [],
    driver: null, horse: null, trailers: [],
    handshakes: [
      makeHandshake(1, 'completed'),
      makeHandshake(2, 'completed'),
      makeHandshake(3, 'in_progress'),
      makeHandshake(4, 'pending'),
      makeHandshake(5, 'pending'),
    ],
    exceptions: [], blockchain_receipts: [],
    created_at: '2026-06-12T08:00:00Z', updated_at: '2026-06-12T08:00:00Z',
  }
}

describe('TripDetailView', () => {
  it('renders the trip reference, order number, and status chip regardless of variant', () => {
    render(
      <TripDetailView
        trip={makeTrip()}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectHandshake={vi.fn()}
        showAllHandshakes={false}
      />,
    )

    expect(screen.getByRole('heading', { name: 'TRP-2026-0099' })).toBeInTheDocument()
    expect(screen.getByText('ORD-99')).toBeInTheDocument()
  })

  it('showAllHandshakes=true (mock trip-detail) lists all five handshakes, only the current one tappable', () => {
    const onSelectHandshake = vi.fn()
    render(
      <TripDetailView
        trip={makeTrip()}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectHandshake={onSelectHandshake}
        showAllHandshakes
      />,
    )

    expect(screen.getByText('Handshakes')).toBeInTheDocument()
    expect(screen.getByText(/H3:/)).toBeInTheDocument()
    expect(screen.getByText(/H5:/)).toBeInTheDocument()

    // H3 is current (in_progress) — its card is tappable.
    fireEvent.click(screen.getByText(/H3:/).closest('[role="button"]')!)
    expect(onSelectHandshake).toHaveBeenCalledWith(3)
  })

  it('showAllHandshakes=false (live active trip) shows only the single current-handshake card', () => {
    const onSelectHandshake = vi.fn()
    render(
      <TripDetailView
        trip={makeTrip()}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectHandshake={onSelectHandshake}
        showAllHandshakes={false}
      />,
    )

    expect(screen.queryByText('Handshakes')).not.toBeInTheDocument()
    expect(screen.queryByText(/H3:/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /origin gate-out/i }))
    expect(onSelectHandshake).toHaveBeenCalledWith(3)
  })

  it('exception_hold suppresses the current-handshake CTA and shows the hold notice (live view)', () => {
    const onSelectHandshake = vi.fn()
    render(
      <TripDetailView
        trip={makeTrip('exception_hold')}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectHandshake={onSelectHandshake}
        showAllHandshakes={false}
      />,
    )

    expect(screen.getByText('Trip on hold')).toBeInTheDocument()
    // No handshake CTA — submits while held can only 409.
    expect(screen.queryByRole('button', { name: /origin gate-out/i })).not.toBeInTheDocument()
  })

  it('exception_hold makes the current handshake card non-tappable (showAllHandshakes)', () => {
    const onSelectHandshake = vi.fn()
    render(
      <TripDetailView
        trip={makeTrip('exception_hold')}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectHandshake={onSelectHandshake}
        showAllHandshakes
      />,
    )

    expect(screen.getByText('Trip on hold')).toBeInTheDocument()
    // The current (H3) card renders but is no longer a button.
    expect(screen.getByText(/H3:/).closest('[role="button"]')).toBeNull()
  })

  it('shows the In-Transit Hub shortcut only while the trip is in_transit', () => {
    const onInTransitHub = vi.fn()
    render(
      <TripDetailView
        trip={makeTrip('in_transit')}
        onBack={vi.fn()}
        onInTransitHub={onInTransitHub}
        onSelectHandshake={vi.fn()}
        showAllHandshakes={false}
      />,
    )

    fireEvent.click(screen.getByText('In-Transit Hub →'))
    expect(onInTransitHub).toHaveBeenCalled()
  })

  it('does not show the In-Transit Hub shortcut for a non-in_transit trip', () => {
    render(
      <TripDetailView
        trip={makeTrip('origin_gate_out')}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectHandshake={vi.fn()}
        showAllHandshakes={false}
      />,
    )

    expect(screen.queryByText('In-Transit Hub →')).not.toBeInTheDocument()
  })

  it('shows an AnchorBadge "Anchored" chip on a completed, Hedera-anchored H2 row (showAllHandshakes)', () => {
    const anchoredTrip = makeTrip()
    anchoredTrip.handshakes = [
      makeHandshake(1, 'completed'),
      makeHandshake(2, 'completed', {
        event_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        blockchain_receipt_id: 'bcr-0035-h2',
      }),
      makeHandshake(3, 'in_progress'),
      makeHandshake(4, 'pending'),
      makeHandshake(5, 'pending'),
    ]

    render(
      <TripDetailView
        trip={anchoredTrip}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectHandshake={vi.fn()}
        showAllHandshakes
      />,
    )

    expect(screen.getByText('Anchored')).toBeInTheDocument()
  })

  it('does not show an AnchorBadge on H1/H3/H4 rows even when completed (unanchored feeder handshakes)', () => {
    render(
      <TripDetailView
        trip={makeTrip()}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectHandshake={vi.fn()}
        showAllHandshakes
      />,
    )

    // H1 is completed in the default fixture but never carries event_hash/receipt —
    // no anchored/anchoring copy should ever appear for it.
    expect(screen.queryByText('Anchored')).not.toBeInTheDocument()
    expect(screen.queryByText('Anchoring…')).not.toBeInTheDocument()
  })

  it('shows a complete AnchorProgress pipeline for H2 in real-data mode (showAllHandshakes=false) when event_hash + receipt id are set', () => {
    const anchoredTrip = makeTrip()
    anchoredTrip.handshakes = [
      makeHandshake(1, 'completed'),
      makeHandshake(2, 'completed', {
        event_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        blockchain_receipt_id: 'bcr-0035-h2',
      }),
      makeHandshake(3, 'in_progress'),
      makeHandshake(4, 'pending'),
      makeHandshake(5, 'pending'),
    ]

    render(
      <TripDetailView
        trip={anchoredTrip}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectHandshake={vi.fn()}
        showAllHandshakes={false}
      />,
    )

    expect(screen.getByText('Evidence anchors')).toBeInTheDocument()
    // AnchorProgress (not AnchorBadge) renders in the real-data branch — all three
    // pipeline rows read complete, with the receipt id shown on the third row.
    expect(screen.getByText(/Evidence hashed/)).toBeInTheDocument()
    expect(screen.getByText('Submitted to Hedera HCS')).toBeInTheDocument()
    expect(screen.getByText(/Anchor receipt recorded — bcr-0035-h2/)).toBeInTheDocument()
    // Evidence anchor rows are not tappable — the current-handshake-only design reserves
    // navigation for the single current-handshake card, not these read-only rows.
    expect(screen.getByText(/H2:/).closest('[role="button"]')).toBeNull()
  })

  it('shows an in-progress AnchorProgress pipeline in real-data mode when event_hash is set but the Hedera receipt id has not come back yet', () => {
    const anchoringTrip = makeTrip('unloading')
    anchoringTrip.handshakes = [
      makeHandshake(1, 'completed'),
      makeHandshake(2, 'completed', {
        event_hash: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2',
        blockchain_receipt_id: 'bcr-0035-h2',
      }),
      makeHandshake(3, 'completed'),
      makeHandshake(4, 'completed'),
      makeHandshake(5, 'in_progress', {
        event_hash: 'f0e1d2c3b4a5968778695a4b3c2d1e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d',
        blockchain_receipt_id: null,
      }),
    ]

    render(
      <TripDetailView
        trip={anchoringTrip}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectHandshake={vi.fn()}
        showAllHandshakes={false}
      />,
    )

    // This fixture's H2 is already anchored, so scope to H5's card specifically —
    // its pipeline is still in progress: the Hedera-submission row is present (its
    // exact "complete" vs "in progress" state is AnchorProgress's own unit-tested
    // concern) and the receipt row has not yet gained a receipt id suffix.
    const h5Card = screen.getByText(/H5:/).closest('div')!
    expect(within(h5Card).getByText('Submitted to Hedera HCS')).toBeInTheDocument()
    expect(within(h5Card).getByText('Anchor receipt recorded')).toBeInTheDocument()
    expect(within(h5Card).queryByText(/Anchor receipt recorded — /)).not.toBeInTheDocument()
  })

  it('renders no "Evidence anchors" section in real-data mode when neither H2 nor H5 has an event_hash', () => {
    render(
      <TripDetailView
        trip={makeTrip()}
        onBack={vi.fn()}
        onInTransitHub={vi.fn()}
        onSelectHandshake={vi.fn()}
        showAllHandshakes={false}
      />,
    )

    // Default fixture's H2 is 'completed' but carries no event_hash/receipt — no
    // section header (not even an empty one) and no pipeline copy should appear.
    expect(screen.queryByText('Evidence anchors')).not.toBeInTheDocument()
    expect(screen.queryByText('Evidence hashed', { exact: false })).not.toBeInTheDocument()
    expect(screen.queryByText('Submitted to Hedera HCS')).not.toBeInTheDocument()
  })

  it('back button in SubpageHeader calls onBack', () => {
    const onBack = vi.fn()
    render(
      <TripDetailView
        trip={makeTrip()}
        onBack={onBack}
        onInTransitHub={vi.fn()}
        onSelectHandshake={vi.fn()}
        showAllHandshakes={false}
      />,
    )

    fireEvent.click(screen.getByText('← My Trips'))
    expect(onBack).toHaveBeenCalled()
  })
})
