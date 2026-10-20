import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { substitutionErrorFixtures, substitutionFixturePack } from '@shared/lib/mocks/driver-substitutions'
import type { Driver } from '@shared/lib/types/driver'
import { ApiError } from '@/lib/api/client'
import { arrangeSubstitution, replaceSubstitution } from '@/lib/api/driverSubstitutions'
import { isoToSastInput } from '@/lib/format/sast'
import { DriverSubstitutionDialog } from './DriverSubstitutionDialog'

// The API client builds a Supabase client at import time — mocked like the other panel tests.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

// Real error-code reader and key generator; only the network calls are replaced.
vi.mock('@/lib/api/driverSubstitutions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/driverSubstitutions')>('@/lib/api/driverSubstitutions')
  return { ...actual, arrangeSubstitution: vi.fn(), replaceSubstitution: vi.fn() }
})

const { outgoingPending, noSubstitution } = substitutionFixturePack
const TRIP_ID = 'trip-under-test'
const base = noSubstitution.driver
if (!base) throw new Error('Fixture trip has no driver')
const DRIVERS: Driver[] = [
  { ...base, id: 'driver-a' as Driver['id'], full_name: 'Fixture Driver Alpha' },
  { ...base, id: 'driver-b' as Driver['id'], full_name: 'Fixture Driver Bravo' },
]

function renderDialog(replacing = null as typeof outgoingPending | null) {
  const onClose = vi.fn()
  const onSaved = vi.fn()
  render(<DriverSubstitutionDialog tripId={TRIP_ID} open drivers={DRIVERS} replacing={replacing} onClose={onClose} onSaved={onSaved} />)
  return { onClose, onSaved }
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

function fillArrange() {
  fireEvent.change(screen.getByLabelText('Incoming driver'), { target: { value: 'driver-b' } })
  fill('Exchange point', '  Fixture Fuel Stop  ')
  fill('Latitude', '-28.2733')
  fill('Longitude', '29.1274')
  fill('Instructions for the drivers', 'Wait by the diesel island.')
  fill('Expected exchange time (SAST)', '2026-10-20T10:30')
  fill('Reason', 'Hours limit reached.')
}

function apiError(status: number, code: keyof typeof substitutionErrorFixtures): ApiError {
  const { body } = substitutionErrorFixtures[code]
  return new ApiError(status, body.detail.message, body.detail)
}

const arrangeButton = () => screen.getByRole('button', { name: 'Arrange handover' })

beforeEach(() => {
  vi.mocked(arrangeSubstitution).mockReset()
  vi.mocked(replaceSubstitution).mockReset()
})

describe('DriverSubstitutionDialog — arrange', () => {
  it('submits the full request with a SAST expected_at and trimmed text', async () => {
    // Arrange
    vi.mocked(arrangeSubstitution).mockResolvedValue(outgoingPending)
    const { onSaved } = renderDialog()
    fillArrange()

    // Act
    await userEvent.click(arrangeButton())

    // Assert
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(outgoingPending))
    expect(arrangeSubstitution).toHaveBeenCalledWith(TRIP_ID, {
      client_request_id: expect.any(String),
      incoming_driver_id: 'driver-b',
      exchange: { label: 'Fixture Fuel Stop', latitude: -28.2733, longitude: 29.1274, instructions: 'Wait by the diesel island.' },
      expected_at: '2026-10-20T10:30:00+02:00',
      is_planned: true,
      reason: 'Hours limit reached.',
    })
  })

  it('sends is_planned false when the planned box is cleared', async () => {
    vi.mocked(arrangeSubstitution).mockResolvedValue(outgoingPending)
    renderDialog()
    fillArrange()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Planned handover' }))
    await userEvent.click(arrangeButton())

    await waitFor(() => expect(arrangeSubstitution).toHaveBeenCalledOnce())
    expect(vi.mocked(arrangeSubstitution).mock.calls[0][1].is_planned).toBe(false)
  })

  it('stays disabled until the required fields are valid', () => {
    renderDialog()
    expect(arrangeButton()).toBeDisabled()

    fillArrange()

    expect(arrangeButton()).toBeEnabled()
  })

  it.each([['91'], ['-90.5'], ['abc']])('disables submit for latitude %s', value => {
    renderDialog()
    fillArrange()

    fill('Latitude', value)

    expect(arrangeButton()).toBeDisabled()
  })

  it('disables submit for a longitude beyond 180', () => {
    renderDialog()
    fillArrange()

    fill('Longitude', '181')

    expect(arrangeButton()).toBeDisabled()
  })

  it('keeps every typed value and explains a 503 SUBSTITUTIONS_DISABLED refusal', async () => {
    // Arrange
    vi.mocked(arrangeSubstitution).mockRejectedValue(apiError(503, 'SUBSTITUTIONS_DISABLED'))
    const { onSaved } = renderDialog()
    fillArrange()

    // Act
    await userEvent.click(arrangeButton())

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('New handovers are switched off right now.')
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Exchange point')).toHaveValue('  Fixture Fuel Stop  ')
    expect(screen.getByLabelText('Latitude')).toHaveValue('-28.2733')
    expect(screen.getByLabelText('Longitude')).toHaveValue('29.1274')
    expect(screen.getByLabelText('Instructions for the drivers')).toHaveValue('Wait by the diesel island.')
    expect(screen.getByLabelText('Expected exchange time (SAST)')).toHaveValue('2026-10-20T10:30')
    expect(screen.getByLabelText('Reason')).toHaveValue('Hours limit reached.')
    expect(screen.getByLabelText('Incoming driver')).toHaveValue('driver-b')
  })

  it('shows the hint for DRIVER_UNAVAILABLE', async () => {
    vi.mocked(arrangeSubstitution).mockRejectedValue(apiError(409, 'DRIVER_UNAVAILABLE'))
    renderDialog()
    fillArrange()

    await userEvent.click(arrangeButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('That driver is committed to another trip then.')
  })

  it('falls back to the server message for an unrecognised ApiError', async () => {
    vi.mocked(arrangeSubstitution).mockRejectedValue(new ApiError(500, 'Server fell over'))
    renderDialog()
    fillArrange()

    await userEvent.click(arrangeButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Server fell over')
  })
})

describe('DriverSubstitutionDialog — replace', () => {
  it('pre-fills from the replaced request and requires a replacement reason', async () => {
    // Arrange
    vi.mocked(replaceSubstitution).mockResolvedValue(outgoingPending)
    // The replaced request's incoming driver must be among the candidates to be selectable.
    const replacing = { ...outgoingPending, incoming: { ...outgoingPending.incoming, id: 'driver-a' } }
    renderDialog(replacing)

    // Assert pre-fill
    expect(screen.getByLabelText('Exchange point')).toHaveValue('Fixture Fuel Stop, Harrismith')
    expect(screen.getByLabelText('Latitude')).toHaveValue('-28.2733')
    expect(screen.getByLabelText('Longitude')).toHaveValue('29.1274')
    expect(screen.getByLabelText('Instructions for the drivers')).toHaveValue(replacing.exchange.instructions)
    expect(screen.getByLabelText('Reason')).toHaveValue(replacing.reason)
    expect(screen.getByLabelText('Incoming driver')).toHaveValue('driver-a')
    expect(screen.getByLabelText('Expected exchange time (SAST)')).toHaveValue(isoToSastInput(replacing.expected_at))
    // Everything is carried over, so only the replacement reason gates the button.
    const replaceButton = screen.getByRole('button', { name: 'Replace handover' })
    expect(replaceButton).toBeDisabled()
    fill('Expected exchange time (SAST)', '2026-10-20T11:00')

    // Act
    fill('Why replace the current arrangement', 'Incoming driver fell ill.')
    await userEvent.click(replaceButton)

    // Assert
    await waitFor(() => expect(replaceSubstitution).toHaveBeenCalledOnce())
    expect(replaceSubstitution).toHaveBeenCalledWith(TRIP_ID, replacing.id, expect.objectContaining({
      expected_version: replacing.version,
      replacement_reason: 'Incoming driver fell ill.',
      incoming_driver_id: 'driver-a',
      expected_at: '2026-10-20T11:00:00+02:00',
    }))
    expect(arrangeSubstitution).not.toHaveBeenCalled()
  })
})

describe('DriverSubstitutionDialog — idempotency key', () => {
  it('reuses the client_request_id on a retry with unchanged content', async () => {
    // Arrange
    vi.mocked(arrangeSubstitution)
      .mockRejectedValueOnce(apiError(503, 'SUBSTITUTIONS_DISABLED'))
      .mockResolvedValueOnce(outgoingPending)
    renderDialog()
    fillArrange()

    // Act
    await userEvent.click(arrangeButton())
    await screen.findByRole('alert')
    await userEvent.click(arrangeButton())

    // Assert
    await waitFor(() => expect(arrangeSubstitution).toHaveBeenCalledTimes(2))
    const [first, second] = vi.mocked(arrangeSubstitution).mock.calls.map(call => call[1].client_request_id)
    expect(second).toBe(first)
  })

  it('uses a new client_request_id once a field is edited after an error', async () => {
    // Arrange
    vi.mocked(arrangeSubstitution)
      .mockRejectedValueOnce(apiError(409, 'DRIVER_UNAVAILABLE'))
      .mockResolvedValueOnce(outgoingPending)
    renderDialog()
    fillArrange()
    await userEvent.click(arrangeButton())
    await screen.findByRole('alert')

    // Act
    fill('Reason', 'Different reason.')
    await userEvent.click(arrangeButton())

    // Assert
    await waitFor(() => expect(arrangeSubstitution).toHaveBeenCalledTimes(2))
    const [first, second] = vi.mocked(arrangeSubstitution).mock.calls.map(call => call[1].client_request_id)
    expect(second).not.toBe(first)
  })
})
