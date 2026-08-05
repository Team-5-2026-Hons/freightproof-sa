import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ToastProvider } from '@/lib/context/ToastContext'
import { PhaseOverrideAction } from './PhaseOverrideAction'
import { overridePhase } from '@/lib/api/client'
import type { PhaseDescriptor, PhaseEventId, PhaseStatus } from '@shared/lib/types/phase'
import type { Trip } from '@shared/lib/types/trip'

// client.ts (even mocked below via importActual, which re-evaluates the real module)
// imports the Supabase client at module scope, which throws without real env vars in
// the test environment — mock it the same way lib/api/client.test.ts does.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// Isolate the component from the real HTTP layer — client.ts's own request/retry
// logic is covered by lib/api/client.test.ts.
vi.mock('@/lib/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/client')>('@/lib/api/client')
  return { ...actual, overridePhase: vi.fn() }
})

const mockedOverridePhase = vi.mocked(overridePhase)

// A minimal but fully-typed PhaseDescriptor — only `status` varies per test, matching
// this component's own gate. Every other field is a harmless default since nothing else
// here reads them.
function buildPhase(status: PhaseStatus): PhaseDescriptor {
  return {
    phase_event_id: 'phase-9' as PhaseEventId,
    trip_id: 'trip-1',
    phase_type: 'departure',
    trip_stop_id: null,
    stop_sequence: 0,
    sequence_number: 3,
    status,
    anchor_status: 'not_required',
    step_recipe: [],
    dispatcher_override_user_id: null,
    dispatcher_override_note: null,
    driver_phone_lat: null,
    driver_phone_lng: null,
    horse_gps_lat: null,
    horse_gps_lng: null,
    pulsit_geofence_confirmed: null,
    seal_number: null,
    seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null,
    gate_photo_artifact_id: null,
    pod_photo_artifact_id: null,
    pod_signature_artifact_id: null,
    parcel_count_origin: null,
    parcel_count_destination: null,
    driver_visual_count: null,
    event_hash: null,
    blockchain_receipt_id: null,
    idempotency_key: null,
    completed_at: null,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: '2026-08-01T00:00:00Z',
  }
}

function renderAction(
  status: PhaseStatus,
  onOverridden = vi.fn(),
  tripStatus: Trip['status'] = 'active',
) {
  render(
    <ToastProvider>
      <PhaseOverrideAction
        phase={buildPhase(status)} tripId="trip-1" tripStatus={tripStatus}
        onOverridden={onOverridden}
      />
    </ToastProvider>,
  )
  return { onOverridden }
}

beforeEach(() => {
  mockedOverridePhase.mockReset()
})

describe('PhaseOverrideAction — availability', () => {
  it.each(['completed', 'exception', 'overridden'] as const)('renders nothing when the phase is %s', (status) => {
    renderAction(status)
    expect(screen.queryByText('Record as unable to complete')).not.toBeInTheDocument()
  })

  it.each(['pending', 'in_progress'] as const)('renders the trigger when the phase is %s', (status) => {
    renderAction(status)
    expect(screen.getByText('Record as unable to complete')).toBeInTheDocument()
  })

  // cancel_trip leaves phase rows PENDING on purpose, so a cancelled trip's rows still
  // look overridable by phase status alone — the backend 409s, and the UI must not offer
  // a control that can only fail.
  it.each(['cancelled', 'closed'] as const)('renders nothing when the trip is %s', (tripStatus) => {
    renderAction('pending', vi.fn(), tripStatus)
    expect(screen.queryByText('Record as unable to complete')).not.toBeInTheDocument()
  })
})

describe('PhaseOverrideAction — required note', () => {
  it('keeps the submit control disabled until the note is non-empty', () => {
    renderAction('pending')
    fireEvent.click(screen.getByText('Record as unable to complete'))

    const submit = screen.getByRole('button', { name: 'Record override' })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Driver phone lost' } })
    expect(submit).not.toBeDisabled()
  })

  it('submits the trimmed note and reports success', async () => {
    mockedOverridePhase.mockResolvedValue({ id: 'trip-1' } as never)
    const { onOverridden } = renderAction('in_progress')

    fireEvent.click(screen.getByText('Record as unable to complete'))
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: '  Driver phone lost  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record override' }))

    await waitFor(() => expect(onOverridden).toHaveBeenCalledTimes(1))
    expect(mockedOverridePhase).toHaveBeenCalledWith('trip-1', 'phase-9', 'Driver phone lost')
  })
})
