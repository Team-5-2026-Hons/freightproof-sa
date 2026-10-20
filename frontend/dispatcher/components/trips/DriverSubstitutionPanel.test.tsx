import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  render(<><DriverSubstitutionPanel trip={trip} onChanged={onChanged} />{trip.pending_driver_substitution && <PendingHandover tripId={trip.id} request={trip.pending_driver_substitution} onChanged={onChanged} onReplace={vi.fn()} canReplace={trip.driver_substitutions_enabled === true} />}</>)
  return { onChanged }
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
  it('shows current and original driver when they differ', () => {
    // Arrange / Act
    renderPanel(tripWith(flagOffDetail))

    // Assert
    expect(screen.getByText('Fixture Driver Incoming')).toBeInTheDocument()
    expect(screen.getByText('Fixture Driver Outgoing (journey record, unchanged)')).toBeInTheDocument()
  })

  it('does not show an original driver row when nobody changed', () => {
    renderPanel(tripWith())

    expect(screen.queryByText('Original driver')).not.toBeInTheDocument()
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
  it('shows how each completed handover was completed, with the recorded identity status', () => {
    renderPanel(tripWith({ driver_substitutions: [normalCompleted, { ...dispatcherAttestedCompleted, id: 'f8300000-0000-4000-8000-000000000199' }] }))

    expect(screen.getByText(/both drivers confirmed/)).toBeInTheDocument()
    expect(screen.getByText(/dispatcher attested/)).toBeInTheDocument()
    expect(screen.getAllByText(/incoming identity verified/)).toHaveLength(2)
  })

  it('says custody did not change for a cancelled handover', () => {
    renderPanel(tripWith({ driver_substitutions: [cancelled] }))

    expect(screen.getByText(/Custody did not change\./)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add clarification' })).not.toBeInTheDocument()
  })

  it('posts a clarification with reason and note and says it cannot change the drivers', async () => {
    // Arrange
    vi.mocked(correctSubstitution).mockResolvedValue(substitutionFixturePack.clarification.pending)
    const { onChanged } = renderPanel(tripWith({ driver_substitutions: [normalCompleted] }))
    await userEvent.click(screen.getByRole('button', { name: 'Add clarification' }))
    expect(screen.getByText(/It cannot change the drivers, the time or who holds the trip\./)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Add clarification' })[0]).toBeDisabled()

    // Act
    fill('Reason', 'Label misspelt')
    fill('Clarification', 'It was the Engen.')
    await userEvent.click(screen.getByRole('button', { name: 'Add clarification' }))

    // Assert
    await waitFor(() => expect(onChanged).toHaveBeenCalledOnce())
    expect(correctSubstitution).toHaveBeenCalledWith(TRIP_BASE.id, normalCompleted.completed_substitution_id, {
      client_request_id: expect.any(String), reason: 'Label misspelt', correction_note: 'It was the Engen.',
    })
  })
})
