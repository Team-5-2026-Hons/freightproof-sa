// frontend/driver-pwa/components/phase/steps/confirmation/__tests__/PodPhoto.test.tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PodPhoto } from '../PodPhoto'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { ConfirmationEvidence } from '@/lib/types/evidence-draft'
import type { PhaseEventId } from '@shared/lib/types/phase'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

// CameraCapture needs native camera APIs and a ToastProvider; it has its own coverage in
// components/phase/__tests__/CameraCapture.test.tsx.
vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture }: { label: string; onCapture: (dataUrl: string) => void }) => (
    <button onClick={() => onCapture(`data:image/jpeg;base64,${label}`)}>{label}</button>
  ),
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

const EMPTY_DRAFT: ConfirmationEvidence = {
  podPhotoDataUrl: null,
  podPhotoArtifactId: null,
  podSignatureArtifactId: null,
  receiverConfirmedAt: null,
  driverVisualCount: null,
  reconciliationNote: null,
  capturedAt: null,
}

describe('PodPhoto — evidence attribution', () => {
  beforeEach(() => vi.clearAllMocks())

  it('captures with this phase and the step\'s role', () => {
    const phase = makePhase('confirmation', { phase_event_id: 'phase-event-99' as PhaseEventId })
    render(
      <PodPhoto
        tripId="t1"
        phase={phase}
        stepIndex={0}
        draft={EMPTY_DRAFT}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Proof of delivery photo'))

    expect(mockUseArtifactUpload).toHaveBeenCalledWith('t1', 'phase-event-99')
    expect(mockUploadNow).toHaveBeenCalledWith(
      'data:image/jpeg;base64,Proof of delivery photo', 'photo', expect.any(String), 'pod_photo',
    )
  })
})
