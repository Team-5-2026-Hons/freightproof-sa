import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { substitutionErrorFixtures, substitutionFixturePack } from '@shared/lib/mocks/driver-substitutions'
import type { LateEvidenceDetailRead } from '@shared/lib/types/driver-substitution'
import { ApiError } from '@/lib/api/client'
import { acknowledgeLateEvidence, listLateEvidence } from '@/lib/api/driverSubstitutions'
import { ForensicModeProvider } from '@/lib/context/ForensicModeContext'
import { LateDriverEvidencePanel } from './LateDriverEvidencePanel'

// The API client builds a Supabase client at import time — mocked like the other panel tests.
vi.mock('@/lib/supabase/client', () => ({
  supabase: { auth: { getSession: vi.fn(), signOut: vi.fn(), onAuthStateChange: vi.fn() } },
  getAccessToken: vi.fn(),
}))

vi.mock('@/lib/api/driverSubstitutions', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/driverSubstitutions')>('@/lib/api/driverSubstitutions')
  return { ...actual, listLateEvidence: vi.fn(), acknowledgeLateEvidence: vi.fn() }
})

vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }))

const { lateEvidence } = substitutionFixturePack
const item: LateEvidenceDetailRead = lateEvidence.detail
const TRIP_ID = 'trip-under-test'
const NAMES = { [item.driver_id]: 'Fixture Driver Outgoing' }

function renderPanel(names: Record<string, string> = NAMES) {
  render(<ForensicModeProvider><LateDriverEvidencePanel tripId={TRIP_ID} driverNames={names} /></ForensicModeProvider>)
}

beforeEach(() => {
  vi.mocked(listLateEvidence).mockReset()
  vi.mocked(acknowledgeLateEvidence).mockReset()
})

describe('LateDriverEvidencePanel', () => {
  it('renders nothing when there is no late evidence', async () => {
    // Arrange
    vi.mocked(listLateEvidence).mockResolvedValue([])

    // Act
    renderPanel()

    // Assert
    await waitFor(() => expect(listLateEvidence).toHaveBeenCalledWith(TRIP_ID))
    expect(screen.queryByRole('heading', { name: 'Late driver evidence' })).not.toBeInTheDocument()
  })

  it('lists the driver, kind, custody period and awaiting-review status', async () => {
    // Arrange
    vi.mocked(listLateEvidence).mockResolvedValue([item])

    // Act
    renderPanel()

    // Assert
    expect(await screen.findByText('Fixture Driver Outgoing · checkpoint · custody period 0')).toBeInTheDocument()
    expect(screen.getByText('Awaiting review')).toBeInTheDocument()
    expect(screen.getByText('b'.repeat(64))).toBeInTheDocument()
  })

  it('names an unknown driver as such', async () => {
    vi.mocked(listLateEvidence).mockResolvedValue([item])

    renderPanel({})

    expect(await screen.findByText(/Unknown driver · checkpoint/)).toBeInTheDocument()
  })

  it('shows a reviewed item with its note and no acknowledge button', async () => {
    vi.mocked(listLateEvidence).mockResolvedValue([{ ...item, status: 'acknowledged', review_note: 'Looks consistent.' }])

    renderPanel()

    expect(await screen.findByText('Reviewed')).toBeInTheDocument()
    expect(screen.getByText('Review note: Looks consistent.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument()
  })

  it('requires a note, then acknowledges and refetches', async () => {
    // Arrange
    vi.mocked(listLateEvidence).mockResolvedValue([item])
    vi.mocked(acknowledgeLateEvidence).mockResolvedValue(lateEvidence.acknowledged)
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    expect(screen.getByRole('button', { name: 'Record review' })).toBeDisabled()

    // Act
    fireEvent.change(screen.getByLabelText('Review note'), { target: { value: '  Photo matches.  ' } })
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }))

    // Assert
    await waitFor(() => expect(acknowledgeLateEvidence).toHaveBeenCalledWith(TRIP_ID, item.id, {
      client_request_id: expect.any(String), note: 'Photo matches.',
    }))
    await waitFor(() => expect(listLateEvidence).toHaveBeenCalledTimes(2))
  })

  it('says another dispatcher already reviewed it on SUBSTITUTION_VERSION_CHANGED', async () => {
    // Arrange
    const { body } = substitutionErrorFixtures.SUBSTITUTION_VERSION_CHANGED
    vi.mocked(listLateEvidence).mockResolvedValue([item])
    vi.mocked(acknowledgeLateEvidence).mockRejectedValue(new ApiError(409, body.detail.message, body.detail))
    renderPanel()
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge' }))
    fireEvent.change(screen.getByLabelText('Review note'), { target: { value: 'Photo matches.' } })

    // Act
    await userEvent.click(screen.getByRole('button', { name: 'Record review' }))

    // Assert
    expect(await screen.findByRole('alert')).toHaveTextContent('Another dispatcher already reviewed this.')
    await waitFor(() => expect(listLateEvidence).toHaveBeenCalledTimes(2))
  })
})

it('renders_payload_and_authorised_photos_before_review', async () => {
  const description = 'Rear tyre damaged before handover'
  vi.mocked(listLateEvidence).mockResolvedValue([{
    ...item, evidence: { kind: 'exception', payload: { exception_type: 'mechanical', description } },
  }])
  renderPanel()
  expect(await screen.findByText(description)).toBeVisible()
  expect(screen.getByRole('button', { name: /Open retained photo 1/i })).toBeVisible()
  expect(screen.getByAltText('Retained photo 1')).toHaveAttribute('src', item.artifacts[0].signed_url)
})

it('new_receipt_appears_after_event_or_refocus', async () => {
  vi.mocked(listLateEvidence).mockResolvedValueOnce([]).mockResolvedValue([item])
  renderPanel()
  await waitFor(() => expect(listLateEvidence).toHaveBeenCalledTimes(1))
  fireEvent(window, new Event('focus'))
  expect(await screen.findByText(/Fixture Driver Outgoing · checkpoint/)).toBeVisible()
})
