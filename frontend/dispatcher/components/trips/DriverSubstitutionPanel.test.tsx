import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mockTrips } from '@shared/lib/mocks'
import { substitutionErrorFixtures, substitutionFixturePack } from '@shared/lib/mocks/driver-substitutions'
import type { SubstitutionRequestRead } from '@shared/lib/types/driver-substitution'
import type { Trip } from '@shared/lib/types/trip'
import { ApiError } from '@/lib/api/client'
import { cancelSubstitution, completeSubstitution, correctSubstitution } from '@/lib/api/driverSubstitutions'
import { useDrivers } from '@/lib/hooks/useDrivers'
import { DriverSubstitutionPanel, PendingHandover } from './DriverSubstitutionPanel'

// The API client builds a Supabase client at import time — mocked like the other panel tests.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// Keep the real error-code reader and key generator: they are the behaviour under test.
vi.mock('@/lib/api/driverSubstitutions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/driverSubstitutions')>('@/lib/api/driverSubstitutions')
  return {
    ...actual,
    arrangeSubstitution: vi.fn(), replaceSubstitution: vi.fn(),
    cancelSubstitution: vi.fn(), completeSubstitution: vi.fn(), correctSubstitution: vi.fn(),
  }
})

vi.mock('@/lib/hooks/useDrivers', () => ({ useDrivers: vi.fn() }))

const { noSubstitution, flagOffDetail, normalCompleted, dispatcherAttestedCompleted, cancelled, outgoingPending, oneConfirmation } = substitutionFixturePack
const TRIP_BASE: Trip = { ...mockTrips[0], status: 'active', ...noSubstitution }

function tripWith(overrides: Partial<Trip> = {}): Trip {
  return { ...TRIP_BASE, ...overrides }
}

function pendingRequest(overrides: Partial<SubstitutionRequestRead> = {}): SubstitutionRequestRead {
  return { ...oneConfirmation, permitted_actions: ['cancel', 'replace', 'complete_attested'], ...overrides }
}

function renderPanel(trip: Trip) {
  const onChanged = vi.fn()
  const onOpenTransfer = vi.fn()
  render(<><DriverSubstitutionPanel trip={trip} onOpenTransfer={onOpenTransfer} />{trip.pending_driver_substitution && <PendingHandover tripId={trip.id} request={trip.pending_driver_substitution} onChanged={onChanged} onReplace={vi.fn()} canReplace={trip.driver_substitutions_enabled === true} />}</>)
  return { onChanged, onOpenTransfer }
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function apiError(status: number, code: keyof typeof substitutionErrorFixtures): ApiError {
  const { body } = substitutionErrorFixtures[code]
  return new ApiError(status, body.detail.message, body.detail)
}

beforeEach(() => {
  vi.mocked(useDrivers).mockReturnValue({ drivers: [], isLoading: false, error: null, refetch: vi.fn() })
  vi.mocked(cancelSubstitution).mockReset()
  vi.mocked(completeSubstitution).mockReset()
  vi.mocked(correctSubstitution).mockReset()
})

describe('DriverSubstitutionPanel — drivers and arrange button', () => {
  it('names both drivers on the handover row instead of repeating current and original driver rows', () => {
    // Arrange / Act
    renderPanel(tripWith(flagOffDetail))

    // Assert
    expect(screen.getByText('Fixture Driver Outgoing → Fixture Driver Incoming')).toBeInTheDocument()
    expect(screen.queryByText('Current driver')).not.toBeInTheDocument()
    expect(screen.queryByText(/journey record, unchanged/)).not.toBeInTheDocument()
  })

  it('says there are no driver changes when nobody changed', () => {
    renderPanel(tripWith())

    expect(screen.queryByText('Original driver')).not.toBeInTheDocument()
    expect(screen.getByText('No driver changes on this trip.')).toBeInTheDocument()
  })

  it('keeps initiation in the header when enabled and live', () => {
    renderPanel(tripWith())

    expect(screen.queryByRole('button', { name: 'Arrange handover' })).not.toBeInTheDocument()
    expect(screen.queryByText(/New handovers are switched off/)).not.toBeInTheDocument()
  })

  it('keeps initiation in the header during exception hold', () => {
    renderPanel(tripWith({ status: 'exception_hold' }))

    expect(screen.queryByRole('button', { name: 'Arrange handover' })).not.toBeInTheDocument()
  })

  it('hides "Arrange handover" when the trip is not live', () => {
    renderPanel(tripWith({ status: 'closed' }))

    expect(screen.queryByRole('button', { name: 'Arrange handover' })).not.toBeInTheDocument()
  })

  it('hides "Arrange handover" while an arrangement is pending', () => {
    renderPanel(tripWith({ pending_driver_substitution: pendingRequest() }))

    expect(screen.queryByRole('button', { name: 'Arrange handover' })).not.toBeInTheDocument()
  })

  it('says new handovers are switched off and offers no arrange button when the flag is off', () => {
    renderPanel(tripWith({ ...noSubstitution, driver_substitutions_enabled: false }))

    expect(screen.getByText(/New handovers are switched off/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arrange handover' })).not.toBeInTheDocument()
  })


})

describe('DriverSubstitutionPanel — pending arrangement', () => {
  it('shows the exchange, planned-point copy, missing roles and the recorded identity status', () => {
    // Arrange
    const request = pendingRequest({ identity: { ...oneConfirmation.identity, status: 'pending' } })

    // Act
    renderPanel(tripWith({ pending_driver_substitution: request }))

    // Assert
    expect(screen.getByText(/Planned exchange: Fixture Fuel Stop, Harrismith/)).toBeInTheDocument()
    expect(screen.getByText(/not the vehicle’s live position/)).toBeInTheDocument()
    expect(screen.getByText(/Confirmed by: outgoing · waiting for incoming/)).toBeInTheDocument()
    // The recorded status is shown as-is, never relabelled as verified.
    expect(screen.getByText('Incoming driver identity: pending')).toBeInTheDocument()
  })

  it('shows the message for what is blocking completion', () => {
    renderPanel(tripWith({ pending_driver_substitution: pendingRequest({ completion_blocked_by: 'licence_invalid', missing_confirmations: [] }) }))

    expect(screen.getByRole('status')).toHaveTextContent('The incoming driver’s licence expiry is missing or has passed.')
  })

  it('offers only the actions the server permitted', () => {
    renderPanel(tripWith({ pending_driver_substitution: outgoingPending }))

    expect(screen.queryByRole('button', { name: 'Complete handover' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel handover' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument()
  })

  it('shows the custody integrity findings when the chain failed', () => {
    renderPanel(tripWith({ custody_integrity: substitutionFixturePack.custodyIntegrityFailed }))

    expect(screen.getByText('Integrity problem')).toBeInTheDocument()
    expect(screen.getByText('Amendment 2 does not reference the hash of amendment 1.')).toBeInTheDocument()
  })
})

describe('DriverSubstitutionPanel — complete', () => {
  it('requires a reason when a confirmation is missing, then sends it with version and key', async () => {
    // Arrange
    vi.mocked(completeSubstitution).mockResolvedValue(dispatcherAttestedCompleted)
    const request = pendingRequest()
    const { onChanged } = renderPanel(tripWith({ pending_driver_substitution: request }))
    await userEvent.click(screen.getByRole('button', { name: 'Complete handover' }))
    expect(screen.getByRole('button', { name: 'Complete' })).toBeDisabled()

    // Act
    fill('Why complete without both confirmations', '  Outgoing phone is dead.  ')
    await userEvent.click(screen.getByRole('button', { name: 'Complete' }))

    // Assert
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(completeSubstitution).toHaveBeenCalledWith(TRIP_BASE.id, request.id, {
      client_request_id: expect.any(String),
      expected_version: request.version,
      missing_confirmation_reason: 'Outgoing phone is dead.',
      identity_unavailable_reason: null,
      declared_exchange_at: null,
    })
  })

  it('needs no missing-confirmation reason when both drivers confirmed', async () => {
    // Arrange
    vi.mocked(completeSubstitution).mockResolvedValue(normalCompleted)
    const request = pendingRequest({ missing_confirmations: [], completion_blocked_by: 'driver_unavailable' })
    renderPanel(tripWith({ pending_driver_substitution: request }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Complete handover' }))

    // Assert
    expect(screen.queryByLabelText('Why complete without both confirmations')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete' })).toBeEnabled()
  })

  it('sends the identity attestation reason and a SAST exchange time when given', async () => {
    // Arrange
    vi.mocked(completeSubstitution).mockResolvedValue(normalCompleted)
    const request = pendingRequest({ missing_confirmations: [], permitted_actions: ['complete_attested', 'attest_identity'] })
    renderPanel(tripWith({ pending_driver_substitution: request }))
    await userEvent.click(screen.getByRole('button', { name: 'Complete handover' }))

    // Act
    fill('Attest unavailable identity verification (admin; leave empty to not attest)', 'Checked in person.')
    fill('Physical exchange time, if earlier (SAST)', '2026-10-20T10:30')
    await userEvent.click(screen.getByRole('button', { name: 'Complete' }))

    // Assert
    await waitFor(() => expect(completeSubstitution).toHaveBeenCalledOnce())
    expect(vi.mocked(completeSubstitution).mock.calls[0][2]).toMatchObject({
      identity_unavailable_reason: 'Checked in person.',
      declared_exchange_at: '2026-10-20T10:30:00+02:00',
      missing_confirmation_reason: null,
    })
  })

  it('shows the identity attestation field only when attest_identity is permitted', async () => {
    // Arrange
    const label = 'Attest unavailable identity verification (admin; leave empty to not attest)'
    renderPanel(tripWith({ pending_driver_substitution: pendingRequest() }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Complete handover' }))

    // Assert
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
  })

  it('shows the identity attestation field for a permitted admin', async () => {
    renderPanel(tripWith({ pending_driver_substitution: pendingRequest({ permitted_actions: ['complete_attested', 'attest_identity'] }) }))

    await userEvent.click(screen.getByRole('button', { name: 'Complete handover' }))

    expect(screen.getByLabelText('Attest unavailable identity verification (admin; leave empty to not attest)')).toBeInTheDocument()
  })

  it('explains a 403 IDENTITY_ATTESTATION_FORBIDDEN and does not refetch', async () => {
    // Arrange
    vi.mocked(completeSubstitution).mockRejectedValue(apiError(403, 'IDENTITY_ATTESTATION_FORBIDDEN'))
    const { onChanged } = renderPanel(tripWith({ pending_driver_substitution: pendingRequest({ missing_confirmations: [] }) }))
    await userEvent.click(screen.getByRole('button', { name: 'Complete handover' }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Complete' }))

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Only an admin dispatcher can attest unavailable identity.')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it('refetches when another dispatcher already changed the request (old version returned)', async () => {
    // Arrange
    vi.mocked(completeSubstitution).mockRejectedValue(apiError(409, 'SUBSTITUTION_VERSION_CHANGED'))
    const { onChanged } = renderPanel(tripWith({ pending_driver_substitution: pendingRequest({ missing_confirmations: [] }) }))
    await userEvent.click(screen.getByRole('button', { name: 'Complete handover' }))

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Complete' }))

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Someone else changed this handover. It has been refreshed.')
    expect(onChanged).toHaveBeenCalledOnce()
  })
})

describe('DriverSubstitutionPanel — cancel', () => {
  it('requires a reason and then cancels with the version', async () => {
    // Arrange
    vi.mocked(cancelSubstitution).mockResolvedValue(cancelled)
    const request = pendingRequest()
    const { onChanged } = renderPanel(tripWith({ pending_driver_substitution: request }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel handover' }))
    const confirm = screen.getByRole('button', { name: 'Cancel handover' })
    expect(confirm).toBeDisabled()

    // Act
    fill('Why cancel', 'Trip rerouted.')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel handover' }))

    // Assert
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(cancelSubstitution).toHaveBeenCalledWith(TRIP_BASE.id, request.id, {
      client_request_id: expect.any(String), expected_version: request.version, reason: 'Trip rerouted.',
    })
  })
})

describe('DriverSubstitutionPanel — history', () => {
  it('shows how each completed handover was completed, and flags only an identity that is not verified', () => {
    renderPanel(tripWith({ driver_substitutions: [
      { ...normalCompleted, request_format: 'immediate_v2' },
      { ...dispatcherAttestedCompleted, id: 'f8300000-0000-4000-8000-000000000199', identity: { ...dispatcherAttestedCompleted.identity, status: 'pending' } },
    ] }))

    expect(screen.getByText(/Driver accepted/)).toBeInTheDocument()
    expect(screen.getByText(/Completed by dispatcher/)).toBeInTheDocument()
    expect(screen.getAllByText('Identity not verified')).toHaveLength(1)
  })

  it('keeps "both drivers confirmed" for a legacy two-confirmation handover', () => {
    renderPanel(tripWith({ driver_substitutions: [{ ...normalCompleted, request_format: 'planned_v1' }] }))

    expect(screen.getByText(/Both drivers confirmed/)).toBeInTheDocument()
    expect(screen.queryByText(/Driver accepted/)).not.toBeInTheDocument()
  })

  it('lists completed and cancelled handovers together in time order', () => {
    const early = { ...cancelled, id: 'early', created_at: '2026-10-20T08:00:00Z', effective_at: null, outgoing: { ...cancelled.outgoing, full_name: 'Early Out' }, incoming: { ...cancelled.incoming, full_name: 'Early In' } }
    const middle = { ...normalCompleted, id: 'middle', effective_at: '2026-10-20T10:00:00Z', outgoing: { ...normalCompleted.outgoing, full_name: 'Middle Out' }, incoming: { ...normalCompleted.incoming, full_name: 'Middle In' } }
    const late = { ...cancelled, id: 'late', created_at: '2026-10-20T12:00:00Z', effective_at: null, outgoing: { ...cancelled.outgoing, full_name: 'Late Out' }, incoming: { ...cancelled.incoming, full_name: 'Late In' } }

    // Given out of order, and with the completed one between two cancelled ones.
    renderPanel(tripWith({ driver_substitutions: [late, middle, early] }))

    const rows = within(screen.getByRole('list', { name: 'Handover history' })).getAllByRole('listitem').map(row => row.textContent ?? '')
    expect(rows[0]).toMatch(/Early Out → Early In · cancelled/)
    expect(rows[1]).toMatch(/Middle Out → Middle In/)
    expect(rows[2]).toMatch(/Late Out → Late In · cancelled/)
  })

  it('keeps a cancelled handover listed as audit history, muted and not openable', () => {
    renderPanel(tripWith({ driver_substitutions: [normalCompleted, cancelled] }))

    expect(screen.getByText(/cancelled\. Custody did not change\./)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /View evidence/ })).toHaveLength(1)
  })

  it('says the custody record is verified, and warns only when it is not', () => {
    const integrity = (status: 'verified' | 'pending' | 'failed', extra = {}) => ({ status, amendment_count: 1, pending_anchor_count: 0, findings: [], ...extra })
    const { unmount } = render(<DriverSubstitutionPanel trip={tripWith({ driver_substitutions: [normalCompleted], custody_integrity: integrity('verified') })} onOpenTransfer={vi.fn()} />)
    expect(screen.getByText('Custody record verified')).toBeInTheDocument()
    unmount()

    render(<DriverSubstitutionPanel trip={tripWith({ driver_substitutions: [normalCompleted], custody_integrity: integrity('pending', { pending_anchor_count: 2 }) })} onOpenTransfer={vi.fn()} />)
    expect(screen.queryByText('Custody record verified')).not.toBeInTheDocument()
    expect(screen.getByText('Anchoring pending')).toBeInTheDocument()
    expect(screen.getByText(/2 record\(s\) waiting to be anchored/)).toBeInTheDocument()
  })

  it('says custody did not change for a cancelled handover', () => {
    renderPanel(tripWith({ driver_substitutions: [cancelled] }))

    expect(screen.getByText(/Custody did not change\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add clarification' })).not.toBeInTheDocument()
  })

  it('offers no clarification form: that lives in the transfer evidence', () => {
    renderPanel(tripWith({ driver_substitutions: [normalCompleted] }))

    expect(screen.queryByRole('button', { name: 'Add clarification' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Clarification')).not.toBeInTheDocument()
    expect(correctSubstitution).not.toHaveBeenCalled()
  })

  it('opens the transfer evidence from a completed row', async () => {
    const { onOpenTransfer } = renderPanel(tripWith({ driver_substitutions: [normalCompleted] }))

    await userEvent.click(screen.getByRole('button', { name: /View evidence/ }))

    expect(onOpenTransfer).toHaveBeenCalledExactlyOnceWith(normalCompleted.completed_substitution_id)
  })

  it('gives a cancelled row no way into evidence it never produced', () => {
    renderPanel(tripWith({ driver_substitutions: [cancelled] }))

    expect(screen.queryByRole('button', { name: /View evidence/ })).not.toBeInTheDocument()
    expect(screen.getByText(/Custody did not change\./)).toBeInTheDocument()
  })

  it('has no custody period row: the handover count belongs to the section summary', () => {
    renderPanel(tripWith({ driver_substitutions: [normalCompleted], custody_sequence: 2 }))

    expect(screen.queryByText('Custody period')).not.toBeInTheDocument()
  })
})
