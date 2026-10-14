// Overhaul 9.1: the delivery photo. The photo is mandatory proof of delivery.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PodPhoto } from '../PodPhoto'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))
vi.mock('@/lib/hooks/useArtifactUpload', () => ({
  useArtifactUpload: () => ({ uploadNow: vi.fn().mockResolvedValue(null) }),
}))
vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture }: { label: string; onCapture: (dataUrl: string) => void }) => (
    <button onClick={() => onCapture('data:image/jpeg;base64,POD')}>{label}</button>
  ),
}))

function makeDraft(overrides: Partial<ConfirmationEvidence> = {}): ConfirmationEvidence {
  return {
    podPhotoDataUrl: null, podPhotoArtifactId: null, podSignatureArtifactId: null, receiverConfirmedAt: null,
    driverVisualCount: null, reconciliationNote: null, capturedAt: null, ...overrides,
  }
}

function renderStep(draft = makeDraft(), onUpdate = vi.fn()) {
  render(<PodPhoto tripId="t1" phase={makePhase('confirmation')} stepIndex={0} draft={draft} onUpdate={onUpdate} onComplete={vi.fn()} />)
  return onUpdate
}

describe('PodPhoto (9.1)', () => {
  it('test_waits_for_the_delivery_photo', () => {
    renderStep()

    expect(screen.getByRole('slider', { name: 'Swipe to Save Photo' })).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText('Add the delivery photo first')).toBeInTheDocument()
  })

  it('test_is_ready_once_the_photo_exists', () => {
    renderStep(makeDraft({ podPhotoDataUrl: 'data:image/jpeg;base64,POD' }))

    expect(screen.getByRole('slider', { name: 'Swipe to Save Photo' })).toHaveAttribute('aria-disabled', 'false')
  })

  it('test_records_the_photo_and_clears_a_stale_artifact', () => {
    const onUpdate = renderStep()

    fireEvent.click(screen.getByRole('button', { name: 'Delivery photo' }))

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ podPhotoDataUrl: 'data:image/jpeg;base64,POD', podPhotoArtifactId: null }))
  })
})
