// Overhaul 5.3: the departure review. Every rule the old EvidenceReview version held is
// pinned here too: both halves required, no GPS claim before the swipe.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConfirmDeparture } from '../ConfirmDeparture'
import { SINGLE_LEG_PHASE_PLAN } from '@shared/lib/mocks/phase-trips'
import type { DepartureEvidence } from '@/lib/types/evidence-draft'

const mockPush = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), back: vi.fn() }),
}))
vi.mock('@/lib/hooks/useOptionalTrip', () => ({ useOptionalTrip: () => null }))

const departure = SINGLE_LEG_PHASE_PLAN.find((p) => p.phase_type === 'departure')!

function makeDraft(overrides: Partial<DepartureEvidence> = {}): DepartureEvidence {
  return {
    sealNumber: 'AB-4471',
    sealPhotoDataUrl: 'data:image/jpeg;base64,AAAA',
    sealPhotoArtifactId: null,
    capturedAt: new Date(2026, 9, 14, 9, 58).toISOString(),
    ...overrides,
  }
}

function renderStep(draft: DepartureEvidence = makeDraft()) {
  render(<ConfirmDeparture tripId="trip-1" phase={departure} stepIndex={1} draft={draft} onComplete={vi.fn()} />)
}

beforeEach(() => mockPush.mockClear())

describe('ConfirmDeparture (5.3)', () => {
  it('test_shows_the_seal_number_and_when_the_photo_was_taken', () => {
    renderStep()

    expect(screen.getByText('AB-4471')).toBeInTheDocument()
    expect(screen.getByText('Captured 09:58')).toBeInTheDocument()
    expect(screen.getByAltText('Seal photo')).toBeInTheDocument()
  })

  it('test_edit_and_retake_both_go_back_to_the_capture_step', () => {
    renderStep()

    fireEvent.click(screen.getByRole('button', { name: 'Edit seal number' }))
    fireEvent.click(screen.getByRole('button', { name: 'Retake seal photo' }))

    expect(mockPush).toHaveBeenNthCalledWith(1, '/trip/phase/departure/step/2-capture-seal')
    expect(mockPush).toHaveBeenNthCalledWith(2, '/trip/phase/departure/step/2-capture-seal')
  })

  it('test_waits_until_both_the_number_and_the_photo_exist', () => {
    renderStep(makeDraft({ sealPhotoDataUrl: null }))

    expect(screen.getByRole('slider', { name: 'Swipe to Depart' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Add number and photo')).toBeInTheDocument()
  })

  it('test_is_ready_once_both_are_captured', () => {
    renderStep()

    expect(screen.getByRole('slider', { name: 'Swipe to Depart' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('test_makes_no_location_claim_before_the_swipe', () => {
    renderStep()

    expect(screen.queryByText(/GPS|location/i)).toBeNull()
  })

  it('test_leaves_out_the_destination_without_a_trip_session', () => {
    renderStep()

    expect(screen.queryByText('Heading to')).toBeNull()
  })
})
