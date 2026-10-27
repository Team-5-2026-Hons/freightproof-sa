// frontend/driver-pwa/components/phase/steps/__tests__/linehaulCapture.test.tsx
//
// Separate from linehaul.test.tsx on purpose: that file renders the real CameraCapture
// (one test asserts its "tap to photograph" copy), while this one needs a stub that can
// fire onCapture. vi.mock is file-wide, so the two cannot share a file.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Linehaul } from '../loading/Linehaul'
import { makePhase } from '@/components/phase/__tests__/testFixtures'
import type { PhaseEventId } from '@shared/lib/types/phase'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}))

vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture }: { label: string; onCapture: (dataUrl: string) => void }) => (
    <button onClick={() => onCapture(`data:image/jpeg;base64,${label}`)}>{label}</button>
  ),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => ({ refreshQuietly: vi.fn(), isRefreshing: false, lastRefreshedAt: null }),
}))

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

describe('Linehaul — evidence attribution', () => {
  beforeEach(() => vi.clearAllMocks())

  it('captures with this phase and the step\'s role', () => {
    const phase = makePhase('loading', { phase_event_id: 'phase-event-55' as PhaseEventId })
    render(
      <Linehaul
        tripId="t1"
        phase={phase}
        stepIndex={0}
        linehaul={null}
        draft={{ linehaulPhotoDataUrl: null, linehaulPhotoArtifactId: null, capturedAt: null }}
        onUpdate={vi.fn()}
        onComplete={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByText('Linehaul sheet'))

    expect(mockUseArtifactUpload).toHaveBeenCalledWith('t1', 'phase-event-55')
    expect(mockUploadNow).toHaveBeenCalledWith(
      'data:image/jpeg;base64,Linehaul sheet', 'photo', expect.any(String), 'linehaul_photo',
    )
  })
})
