// Overhaul 9.1: the delivery photo. The photo is mandatory proof of delivery.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PodPhoto } from '../PodPhoto'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'
import type { PhaseEventId } from '@shared/lib/types/phase'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// The hook is the seam under test here: what matters is the phase id and role this step
// hands it, not the upload itself (lib/hooks/__tests__/useArtifactUpload.test.ts).
const { mockUseArtifactUpload, mockUploadNow } = vi.hoisted(() => ({
  mockUseArtifactUpload: vi.fn(),
  mockUploadNow: vi.fn().mockResolvedValue(null),
}))
vi.mock('@/lib/hooks/useArtifactUpload', () => ({
  useArtifactUpload: (...args: unknown[]) => {
    mockUseArtifactUpload(...args)
    return { uploadNow: mockUploadNow }
  },
}))

// CameraCapture needs native camera APIs and a ToastProvider; it has its own coverage in
// components/phase/__tests__/CameraCapture.test.tsx.
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

beforeEach(() => vi.clearAllMocks())

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

describe('PodPhoto — evidence attribution', () => {
  it('captures with this phase and the step\'s role', () => {
    const phase = makePhase('confirmation', { phase_event_id: 'phase-event-99' as PhaseEventId })
    render(
      <PodPhoto
        tripId="t1"
        phase={phase}
        stepIndex={0}
        draft={makeDraft()}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delivery photo' }))

    expect(mockUseArtifactUpload).toHaveBeenCalledWith('t1', 'phase-event-99')
    expect(mockUploadNow).toHaveBeenCalledWith(
      'data:image/jpeg;base64,POD', 'photo', expect.any(String), 'pod_photo',
    )
  })
})
