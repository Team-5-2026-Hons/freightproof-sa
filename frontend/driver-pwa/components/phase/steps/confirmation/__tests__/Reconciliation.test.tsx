// Overhaul 9.4: one look at what the confirmation carries before the trip can close.
import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { Reconciliation } from '../Reconciliation'
import { CONFIRM_DISPATCH_MS } from '@/components/phase/SwipeToConfirm'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

function makeDraft(overrides: Partial<ConfirmationEvidence> = {}): ConfirmationEvidence {
  return {
    podPhotoDataUrl: 'data:image/jpeg;base64,POD', podPhotoArtifactId: null, podSignatureArtifactId: 'sig-1',
    receiverConfirmedAt: null, driverVisualCount: 46, reconciliationNote: null, capturedAt: null, ...overrides,
  }
}

describe('Reconciliation (9.4)', () => {
  it('test_shows_the_count_and_that_photo_and_signature_are_in', () => {
    render(<Reconciliation tripId="t1" phase={makePhase('confirmation')} stepIndex={2} draft={makeDraft()} onUpdate={vi.fn()} onComplete={vi.fn()} />)

    expect(screen.getByText('Parcels you counted')).toBeInTheDocument()
    expect(screen.getByText('46')).toBeInTheDocument()
    expect(screen.getByLabelText('Delivery photo: recorded')).toBeInTheDocument()
    expect(screen.getByLabelText('Receiver signature: recorded')).toBeInTheDocument()
  })

  it('test_says_not_counted_rather_than_zero', () => {
    render(<Reconciliation tripId="t1" phase={makePhase('confirmation')} stepIndex={2} draft={makeDraft({ driverVisualCount: null })} onUpdate={vi.fn()} onComplete={vi.fn()} />)

    expect(screen.getByText('Not counted')).toBeInTheDocument()
  })

  it('test_marks_a_missing_signature_as_missing', () => {
    render(<Reconciliation tripId="t1" phase={makePhase('confirmation')} stepIndex={2} draft={makeDraft({ podSignatureArtifactId: null })} onUpdate={vi.fn()} onComplete={vi.fn()} />)

    expect(screen.getByLabelText('Receiver signature: missing')).toBeInTheDocument()
  })

  it('test_records_the_reconciliation_note_when_confirmed', () => {
    vi.useFakeTimers()
    const onUpdate = vi.fn()
    const onComplete = vi.fn()
    render(<Reconciliation tripId="t1" phase={makePhase('confirmation')} stepIndex={2} draft={makeDraft()} onUpdate={onUpdate} onComplete={onComplete} />)
    const slider = screen.getByRole('slider', { name: 'Swipe to Confirm All' })

    fireEvent.keyDown(slider, { key: 'Enter' })
    fireEvent.keyDown(slider, { key: 'Enter' })
    act(() => { vi.advanceTimersByTime(CONFIRM_DISPATCH_MS) })

    expect(onUpdate).toHaveBeenCalledWith({ reconciliationNote: expect.any(String) })
    expect(onComplete).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
