import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeAll, beforeEach } from 'vitest'

import { DevTriggerPanel } from '../DevTriggerPanel'
import { useDevTriggers, type UseDevTriggersResult } from '@/lib/hooks/useDevTriggers'
import type {
  CloseScanSessionResponse,
  DevConsignment,
  DevTripStop,
  DevTripSummary,
  MoveTruckResponse,
  ScanTriggerResponse,
  WaypointRead,
} from '@/lib/types/dev'

// Isolate the panel from the real HTTP layer — useDevTriggers itself (and the
// client.ts it wraps) is covered elsewhere; this suite is about the panel's
// derivation and gating logic only.
vi.mock('@/lib/hooks/useDevTriggers', () => ({
  useDevTriggers: vi.fn(),
}))

const mockedUseDevTriggers = vi.mocked(useDevTriggers)

beforeAll(() => {
  // jsdom does not implement HTMLDialogElement.showModal/close (only the `open`
  // reflected attribute exists — see node_modules/jsdom/lib/.../HTMLDialogElement-impl.js).
  // Modal.tsx calls both, so a minimal polyfill is needed for any test that opens
  // the confirmation modal. Scoped to this test file rather than vitest.setup.ts
  // to keep the shared test config untouched.
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement): void {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement): void {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

function makeConsignment(overrides: Partial<DevConsignment> = {}): DevConsignment {
  return {
    consignment_id: 'consignment-1',
    parcel_perfect_reference: 'WB-1',
    barcodes: ['BC-1', 'BC-2'],
    ...overrides,
  }
}

function makeStop(overrides: Partial<DevTripStop> = {}): DevTripStop {
  return {
    trip_stop_id: 'stop-1',
    sequence: 1,
    precinct_name: 'Cape Town Depot',
    pickup_consignments: [],
    delivery_consignments: [],
    loading_phase_status: null,
    confirmation_phase_status: null,
    // Departed by default so existing IN-option tests (written before the early
    // departure gate existed) keep exercising only the condition they name. Tests
    // for the departure gate itself override this explicitly.
    preceding_departure_status: 'completed',
    ...overrides,
  }
}

function makeTrip(overrides: Partial<DevTripSummary> = {}): DevTripSummary {
  return {
    trip_id: 'trip-1',
    trip_reference: 'TRP-0007',
    status: 'active',
    current_phase: 'loading',
    driver_full_name: 'J. Mokoena',
    created_at: '2026-08-01T00:00:00Z',
    stops: [],
    ...overrides,
  }
}

function makeHookReturn(overrides: Partial<UseDevTriggersResult> = {}): UseDevTriggersResult {
  return {
    trips: [],
    waypoints: [],
    isLoading: false,
    error: null,
    lastResult: null,
    loadTrips: vi.fn().mockResolvedValue(undefined),
    triggerScan: vi.fn().mockResolvedValue(null),
    closeScanSession: vi.fn().mockResolvedValue(null),
    triggerPpChange: vi.fn().mockResolvedValue(null),
    triggerException: vi.fn().mockResolvedValue(null),
    flushMockState: vi.fn().mockResolvedValue(null),
    loadWaypoints: vi.fn().mockResolvedValue(undefined),
    moveTruck: vi.fn().mockResolvedValue(null),
    ...overrides,
  }
}

// A successful response. The mocks elsewhere in this file resolve to null, which
// in useDevTriggers means the call FAILED — the post-action refresh deliberately
// does not run in that case, so any test about refreshing needs a real body.
function makeScanResponse(overrides: Partial<ScanTriggerResponse> = {}): ScanTriggerResponse {
  return {
    trip_id: 'trip-1',
    trip_stop_id: 'stop-1',
    direction: 'out',
    consignments: [],
    ...overrides,
  }
}

function makeCloseSessionResponse(
  overrides: Partial<CloseScanSessionResponse> = {},
): CloseScanSessionResponse {
  return {
    trip_id: 'trip-1',
    trip_stop_id: 'stop-1',
    direction: 'out',
    sessions_closed: 1,
    ...overrides,
  }
}

function makeWaypoint(overrides: Partial<WaypointRead> = {}): WaypointRead {
  return {
    waypoint_id: 'precinct',
    label: 'At the precinct',
    sequence: 1,
    description: 'Right where the trip starts.',
    latitude: '-33.9249',
    longitude: '18.4241',
    intended_distance_metres: 0,
    expected_confirmed: true,
    ...overrides,
  }
}

function makeMoveTruckResponse(overrides: Partial<MoveTruckResponse> = {}): MoveTruckResponse {
  return {
    trip_id: 'trip-1',
    waypoint_id: 'precinct',
    waypoint_label: 'At the precinct',
    device_id: 'device-1',
    vehicle_registration: 'CA 123-456',
    precinct_id: 'precinct-1',
    precinct_name: 'Cape Town Depot',
    latitude: '-33.9249',
    longitude: '18.4241',
    has_position: true,
    distance_metres: 0,
    geofence_radius_metres: 250,
    gps_tolerance_metres: 30,
    geofence_confirmed: true,
    in_tolerance_band: true,
    verdict_reason: 'Within the geofence radius.',
    ...overrides,
  }
}

function selectTrip(tripId: string): void {
  fireEvent.change(screen.getByLabelText('Trip'), { target: { value: tripId } })
}

// Reads the option's real value out of the DOM rather than reconstructing the
// panel's internal key format, so this test doesn't couple to that format.
function selectScanOption(namePattern: RegExp): void {
  const option = screen.getByRole('option', { name: namePattern }) as HTMLOptionElement
  fireEvent.change(screen.getByLabelText("What's happening"), { target: { value: option.value } })
}

beforeEach(() => {
  mockedUseDevTriggers.mockReset()
})

describe('DevTriggerPanel — phase gating', () => {
  it('disables the OUT option and the trigger buttons once loading is complete, with a visible reason', () => {
    const stop = makeStop({
      pickup_consignments: [makeConsignment()],
      loading_phase_status: 'completed',
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)

    const option = screen.getByRole('option', { name: /Loading at Cape Town Depot/i }) as HTMLOptionElement
    expect(option.disabled).toBe(true)

    selectScanOption(/Loading at Cape Town Depot/i)
    expect(screen.getByText('Loading is already complete at this stop.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trigger scan' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Scan everything at this stop' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Close scan session/i })).toBeDisabled()
  })

  it('disables the IN option once confirmation is complete', () => {
    const stop = makeStop({
      delivery_consignments: [makeConsignment({ parcel_perfect_reference: 'WB-9', barcodes: ['BC-9'] })],
      confirmation_phase_status: 'completed',
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)

    const option = screen.getByRole('option', { name: /Unloading at Cape Town Depot/i }) as HTMLOptionElement
    expect(option.disabled).toBe(true)

    selectScanOption(/Unloading at Cape Town Depot/i)
    expect(screen.getByText('Confirmation is already complete at this stop.')).toBeInTheDocument()
  })

  // The asymmetry: scan IN is gated by CONFIRMATION, never by unloading itself.
  // The contract has no separate "unloading complete" field at all — a trip that
  // has finished unloading but not yet confirmed just has confirmation_phase_status
  // still open. Gating scan IN on unloading instead is the wrong "fix" a future
  // reader might reach for; this test is the guard against that regression.
  it('does not disable the IN option while confirmation is still open, even though unloading has moved on', () => {
    const stop = makeStop({
      delivery_consignments: [makeConsignment({ parcel_perfect_reference: 'WB-9', barcodes: ['BC-9'] })],
      confirmation_phase_status: 'in_progress',
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)

    const option = screen.getByRole('option', { name: /Unloading at Cape Town Depot/i }) as HTMLOptionElement
    expect(option.disabled).toBe(false)

    selectScanOption(/Unloading at Cape Town Depot/i)
    expect(screen.getByRole('button', { name: 'Trigger scan' })).not.toBeDisabled()
  })

  // The "too early" gap: a scan IN must not be triggerable while the truck is still
  // physically at the preceding stop. null means this stop IS the origin — no
  // departure precedes it at all — and must disable exactly like an open departure.
  it('disables the IN option before the truck has departed, with a visible reason', () => {
    const stop = makeStop({
      delivery_consignments: [makeConsignment({ parcel_perfect_reference: 'WB-9', barcodes: ['BC-9'] })],
      confirmation_phase_status: null,
      preceding_departure_status: null,
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)

    const option = screen.getByRole('option', { name: /Unloading at Cape Town Depot/i }) as HTMLOptionElement
    expect(option.disabled).toBe(true)

    selectScanOption(/Unloading at Cape Town Depot/i)
    expect(screen.getByText("The truck hasn't departed yet.")).toBeInTheDocument()
  })

  it('enables the IN option once the preceding departure has completed', () => {
    const stop = makeStop({
      delivery_consignments: [makeConsignment({ parcel_perfect_reference: 'WB-9', barcodes: ['BC-9'] })],
      confirmation_phase_status: null,
      preceding_departure_status: 'completed',
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)

    const option = screen.getByRole('option', { name: /Unloading at Cape Town Depot/i }) as HTMLOptionElement
    expect(option.disabled).toBe(false)
  })

  // Order matters: a stop that has both departed AND finished confirmation must report
  // the later, more definitive reason — never the departure one, which no longer applies.
  it('reports "already complete", not "not departed", when both conditions hold', () => {
    const stop = makeStop({
      delivery_consignments: [makeConsignment({ parcel_perfect_reference: 'WB-9', barcodes: ['BC-9'] })],
      confirmation_phase_status: 'completed',
      preceding_departure_status: 'completed',
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Unloading at Cape Town Depot/i)

    expect(screen.getByText('Confirmation is already complete at this stop.')).toBeInTheDocument()
    expect(screen.queryByText("The truck hasn't departed yet.")).not.toBeInTheDocument()
  })
})

describe('DevTriggerPanel — barcode picker', () => {
  it('renders barcodes grouped by waybill, all ticked by default', () => {
    const stop = makeStop({
      pickup_consignments: [
        makeConsignment({ consignment_id: 'c1', parcel_perfect_reference: 'WB-1', barcodes: ['BC-1', 'BC-2'] }),
        makeConsignment({ consignment_id: 'c2', parcel_perfect_reference: 'WB-2', barcodes: ['BC-3'] }),
      ],
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)

    // Scoped to the <p> waybill heading — 'WB-1' also appears as an <option> in
    // the PP lifecycle waybill picker further down the panel.
    expect(screen.getByText('WB-1', { selector: 'p' })).toBeInTheDocument()
    expect(screen.getByText('WB-2', { selector: 'p' })).toBeInTheDocument()
    expect((screen.getByLabelText('BC-1') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('BC-2') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('BC-3') as HTMLInputElement).checked).toBe(true)
  })

  it('sends barcodes_by_reference without an unticked barcode and with the rest', async () => {
    const triggerScan = vi.fn().mockResolvedValue(null)
    const stop = makeStop({
      pickup_consignments: [
        makeConsignment({ parcel_perfect_reference: 'WB-1', barcodes: ['BC-1', 'BC-2', 'BC-3'] }),
      ],
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip], triggerScan }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)

    fireEvent.click(screen.getByLabelText('BC-2'))
    fireEvent.click(screen.getByRole('button', { name: 'Trigger scan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(triggerScan).toHaveBeenCalledTimes(1))
    expect(triggerScan).toHaveBeenCalledWith(
      expect.objectContaining({
        trip_id: 'trip-1',
        trip_stop_id: 'stop-1',
        direction: 'out',
        barcodes_by_reference: { 'WB-1': ['BC-1', 'BC-3'] },
      }),
    )
  })

  it('shows the short-count warning only when fewer than all barcodes are ticked', () => {
    const stop = makeStop({
      pickup_consignments: [makeConsignment({ parcel_perfect_reference: 'WB-1', barcodes: ['BC-1', 'BC-2'] })],
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)

    fireEvent.click(screen.getByRole('button', { name: 'Trigger scan' }))
    expect(screen.queryByText(/PARCEL_COUNT_MISMATCH/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    fireEvent.click(screen.getByLabelText('BC-2'))
    fireEvent.click(screen.getByRole('button', { name: 'Trigger scan' }))
    expect(screen.getByText(/PARCEL_COUNT_MISMATCH/i)).toBeInTheDocument()
  })
})

describe('DevTriggerPanel — confirmation modal', () => {
  it('fires nothing on click, fires exactly once on confirm, and fires nothing on cancel', async () => {
    const triggerScan = vi.fn().mockResolvedValue(null)
    const stop = makeStop({
      pickup_consignments: [makeConsignment()],
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip], triggerScan }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)

    fireEvent.click(screen.getByRole('button', { name: 'Trigger scan' }))
    expect(triggerScan).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(triggerScan).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Confirm' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Trigger scan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(triggerScan).toHaveBeenCalledTimes(1))
  })
})

// The panel gates its options on phase statuses carried by the trip list. A scan
// or a close-session can decide those very phases, so without a refresh the picker
// keeps offering a stop the action just closed — the exact case the gating exists
// to prevent.
describe('DevTriggerPanel — refresh after a state-changing action', () => {
  it('refreshes the trip list after a successful scan, without clobbering the scan summary', async () => {
    const loadTrips = vi.fn().mockResolvedValue(undefined)
    const triggerScan = vi.fn().mockResolvedValue(makeScanResponse())
    const stop = makeStop({ pickup_consignments: [makeConsignment()] })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip], loadTrips, triggerScan }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)
    const callsBefore = loadTrips.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Trigger scan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(loadTrips.mock.calls.length).toBe(callsBefore + 1))
    expect(loadTrips).toHaveBeenLastCalledWith({ silent: true })
  })

  it('refreshes the trip list after a successful close-session', async () => {
    const loadTrips = vi.fn().mockResolvedValue(undefined)
    const closeScanSession = vi.fn().mockResolvedValue(makeCloseSessionResponse())
    const stop = makeStop({ pickup_consignments: [makeConsignment()] })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(
      makeHookReturn({ trips: [trip], loadTrips, closeScanSession }),
    )

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)
    const callsBefore = loadTrips.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: /Close scan session/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(loadTrips.mock.calls.length).toBe(callsBefore + 1))
    expect(loadTrips).toHaveBeenLastCalledWith({ silent: true })
  })

  // A failed scan changed nothing on the backend, and the error message is what the
  // operator needs on screen — refreshing over it would replace a real failure with
  // a fresh, unrelated request.
  it('does not refresh when the scan failed', async () => {
    const loadTrips = vi.fn().mockResolvedValue(undefined)
    const triggerScan = vi.fn().mockResolvedValue(null)
    const stop = makeStop({ pickup_consignments: [makeConsignment()] })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip], loadTrips, triggerScan }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)
    const callsBefore = loadTrips.mock.calls.length

    fireEvent.click(screen.getByRole('button', { name: 'Trigger scan' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(triggerScan).toHaveBeenCalledTimes(1))
    expect(loadTrips.mock.calls.length).toBe(callsBefore)
  })
})

describe('DevTriggerPanel — scan everything', () => {
  // Cancel must be a true no-op. Writing the tick state when the modal OPENS
  // destroys a hand-built selection the moment the operator opens it to compare.
  it('leaves the existing tick selection untouched when the modal is cancelled', () => {
    const stop = makeStop({
      pickup_consignments: [makeConsignment({ barcodes: ['BC-1', 'BC-2'] })],
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)

    fireEvent.click(screen.getByLabelText('BC-2'))
    fireEvent.click(screen.getByRole('button', { name: 'Scan everything at this stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect((screen.getByLabelText('BC-1') as HTMLInputElement).checked).toBe(true)
    expect((screen.getByLabelText('BC-2') as HTMLInputElement).checked).toBe(false)
  })

  it('adopts the full manifest and drops extras once confirmed', async () => {
    const triggerScan = vi.fn().mockResolvedValue(makeScanResponse())
    const stop = makeStop({
      pickup_consignments: [makeConsignment({ barcodes: ['BC-1', 'BC-2'] })],
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip], triggerScan }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)

    fireEvent.click(screen.getByLabelText('BC-2'))
    fireEvent.change(screen.getByLabelText('Add barcode not on manifest'), {
      target: { value: 'STRAY-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    fireEvent.click(screen.getByRole('button', { name: 'Scan everything at this stop' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(triggerScan).toHaveBeenCalledTimes(1))
    expect(triggerScan).toHaveBeenCalledWith(
      expect.objectContaining({ barcodes_by_reference: { 'WB-1': ['BC-1', 'BC-2'] } }),
    )
    expect((screen.getByLabelText('BC-2') as HTMLInputElement).checked).toBe(true)
    expect(screen.queryByLabelText(/STRAY-1/)).not.toBeInTheDocument()
  })
})

describe('DevTriggerPanel — not-on-manifest barcodes', () => {
  it('rejects a barcode that is already on the manifest instead of adding it as an extra', () => {
    const stop = makeStop({
      pickup_consignments: [makeConsignment({ barcodes: ['BC-1', 'BC-2'] })],
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)

    fireEvent.change(screen.getByLabelText('Add barcode not on manifest'), {
      target: { value: 'BC-1' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/on the manifest/i)
    expect(screen.queryByLabelText(/BC-1 \(not on manifest\)/)).not.toBeInTheDocument()
  })

  // Two rows sharing a value collide on the React key, and removeExtraBarcode
  // filters by value — so unticking one would silently delete both.
  it('rejects a duplicate extra barcode', () => {
    const stop = makeStop({ pickup_consignments: [makeConsignment()] })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)

    const input = screen.getByLabelText('Add barcode not on manifest')
    fireEvent.change(input, { target: { value: 'STRAY-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    fireEvent.change(input, { target: { value: 'STRAY-1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('alert')).toHaveTextContent(/already been added/i)
    expect(screen.getAllByLabelText(/STRAY-1 \(not on manifest\)/)).toHaveLength(1)
  })
})

describe('DevTriggerPanel — nothing-scanned copy', () => {
  // The backend raises nothing for an empty stage: _reconcile_consignment guards on
  // `if events and (missing or unexpected)`. Promising PARCEL_COUNT_MISMATCH here
  // would tell the operator to expect an exception that never arrives.
  it('does not promise a mismatch exception when no barcode is ticked at all', () => {
    const stop = makeStop({
      pickup_consignments: [makeConsignment({ barcodes: ['BC-1', 'BC-2'] })],
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)

    fireEvent.click(screen.getByLabelText('BC-1'))
    fireEvent.click(screen.getByLabelText('BC-2'))
    fireEvent.click(screen.getByRole('button', { name: 'Trigger scan' }))

    expect(screen.queryByText(/PARCEL_COUNT_MISMATCH/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Nothing scanned for this waybill/i)).toBeInTheDocument()
  })

  it('still promises a mismatch exception when a partial scan will produce one', () => {
    const stop = makeStop({
      pickup_consignments: [makeConsignment({ barcodes: ['BC-1', 'BC-2'] })],
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)

    fireEvent.click(screen.getByLabelText('BC-2'))
    fireEvent.click(screen.getByRole('button', { name: 'Trigger scan' }))

    expect(screen.getByText(/PARCEL_COUNT_MISMATCH/i)).toBeInTheDocument()
  })
})

describe('DevTriggerPanel — Parcel Perfect waybill selection', () => {
  // The PP select draws its options from the current stop+direction. A reference
  // held over from the previous stop renders as a blank select while still arming
  // the submit button against the invisible waybill.
  it('clears the selected waybill when the stop selection changes', () => {
    const stop = makeStop({
      pickup_consignments: [makeConsignment({ consignment_id: 'c1', parcel_perfect_reference: 'WB-1' })],
      delivery_consignments: [
        makeConsignment({ consignment_id: 'c2', parcel_perfect_reference: 'WB-9', barcodes: ['BC-9'] }),
      ],
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip] }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    // Anchored: this is the only test whose stop offers BOTH directions, so an
    // unanchored /Loading at .../ would also match "Unloading at ...".
    selectScanOption(/^Loading at Cape Town Depot$/i)

    const waybillSelect = screen.getByLabelText('Waybill') as HTMLSelectElement
    fireEvent.change(waybillSelect, { target: { value: 'WB-1' } })
    expect(waybillSelect.value).toBe('WB-1')
    expect(screen.getByRole('button', { name: /Apply PP change/i })).not.toBeDisabled()

    selectScanOption(/^Unloading at Cape Town Depot$/i)

    expect((screen.getByLabelText('Waybill') as HTMLSelectElement).value).toBe('')
    expect(screen.getByRole('button', { name: /Apply PP change/i })).toBeDisabled()
  })
})

describe('DevTriggerPanel — move the truck', () => {
  it('renders one button per waypoint, in sequence order', () => {
    const trip = makeTrip()
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({
      trips: [trip],
      waypoints: [
        makeWaypoint({ waypoint_id: 'three_km', label: '3 km away', sequence: 4 }),
        makeWaypoint({ waypoint_id: 'precinct', label: 'At the precinct', sequence: 1 }),
        makeWaypoint({ waypoint_id: 'inside_tolerance', label: '230 m inside tolerance', sequence: 2 }),
      ],
    }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)

    const buttons = screen.getAllByRole('button', {
      name: /At the precinct|230 m inside tolerance|3 km away/,
    })
    expect(buttons.map((b) => b.textContent)).toEqual([
      expect.stringContaining('At the precinct'),
      expect.stringContaining('230 m inside tolerance'),
      expect.stringContaining('3 km away'),
    ])
  })

  it('calls moveTruck with the pressed waypoint id and shows it as active', async () => {
    const moveTruck = vi.fn().mockResolvedValue(
      makeMoveTruckResponse({ waypoint_id: 'inside_tolerance', waypoint_label: '230 m inside tolerance' }),
    )
    const trip = makeTrip()
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({
      trips: [trip],
      waypoints: [makeWaypoint({ waypoint_id: 'inside_tolerance', label: '230 m inside tolerance' })],
      moveTruck,
    }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)

    fireEvent.click(screen.getByRole('button', { name: /230 m inside tolerance/ }))

    await waitFor(() => expect(moveTruck).toHaveBeenCalledWith({
      trip_id: trip.trip_id,
      waypoint_id: 'inside_tolerance',
    }))
    expect(await screen.findByText('Active')).toBeInTheDocument()
    expect(screen.getByText(/Geofence confirmed/i)).toBeInTheDocument()
  })

  // geofence_confirmed is null (not false) on the no_signal waypoint. Rendering it
  // as a failure would tell the operator a fix was received and rejected, when
  // actually no fix was ever received at all.
  it('renders "no verdict" rather than a failure when the tracker has no signal', async () => {
    const moveTruck = vi.fn().mockResolvedValue(makeMoveTruckResponse({
      waypoint_id: 'no_signal',
      waypoint_label: 'No signal',
      latitude: null,
      longitude: null,
      has_position: false,
      distance_metres: null,
      geofence_confirmed: null,
      in_tolerance_band: false,
      verdict_reason: 'No tracker fix received.',
    }))
    const trip = makeTrip()
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({
      trips: [trip],
      waypoints: [makeWaypoint({ waypoint_id: 'no_signal', label: 'No signal' })],
      moveTruck,
    }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)

    fireEvent.click(screen.getByRole('button', { name: /No signal/ }))

    expect(await screen.findByText(/No verdict — tracker dark/i)).toBeInTheDocument()
    expect(screen.queryByText(/Geofence failed/i)).not.toBeInTheDocument()
    expect(screen.getByText('No fix')).toBeInTheDocument()
  })

  it('posts the precinct waypoint id when "Reset to precinct" is pressed', async () => {
    const moveTruck = vi.fn().mockResolvedValue(null)
    const trip = makeTrip()
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({
      trips: [trip],
      waypoints: [makeWaypoint()],
      moveTruck,
    }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)

    fireEvent.click(screen.getByRole('button', { name: 'Reset to precinct' }))

    await waitFor(() => expect(moveTruck).toHaveBeenCalledWith({
      trip_id: trip.trip_id,
      waypoint_id: 'precinct',
    }))
  })

  it('does not call moveTruck when no trip is selected yet', () => {
    const moveTruck = vi.fn().mockResolvedValue(null)
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [], moveTruck }))

    render(<DevTriggerPanel heading="Dev triggers" />)

    expect(screen.getByText('Select a trip above to move its truck.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset to precinct' }))
    expect(moveTruck).not.toHaveBeenCalled()
  })
})

describe('DevTriggerPanel — close session', () => {
  it('calls closeScanSession with the selected stop and direction', async () => {
    const closeScanSession = vi.fn().mockResolvedValue(null)
    const stop = makeStop({
      pickup_consignments: [makeConsignment()],
    })
    const trip = makeTrip({ stops: [stop] })
    mockedUseDevTriggers.mockReturnValue(makeHookReturn({ trips: [trip], closeScanSession }))

    render(<DevTriggerPanel heading="Dev triggers" />)
    selectTrip(trip.trip_id)
    selectScanOption(/Loading at Cape Town Depot/i)

    fireEvent.click(screen.getByRole('button', { name: /Close scan session/i }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(closeScanSession).toHaveBeenCalledTimes(1))
    expect(closeScanSession).toHaveBeenCalledWith({
      trip_id: 'trip-1',
      trip_stop_id: 'stop-1',
      direction: 'out',
    })
  })
})
