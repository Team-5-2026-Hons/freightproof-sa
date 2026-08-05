// frontend/driver-pwa/app/(app)/trip/in-transit/checkpoint/__tests__/CheckpointPageClient.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import CheckpointPageClient from '../CheckpointPageClient'
import { ROUTES } from '@/lib/constants/routes'
import { ApiError } from '@/lib/api/client'

const mockUseTrip = vi.fn()
const mockRouterPush = vi.fn()
const mockRouterBack = vi.fn()
const mockRouterReplace = vi.fn()
const mockNotify = vi.fn()
const mockEnqueueCheckpoint = vi.fn()
const mockSubmitCheckpoint = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockRouterPush, back: mockRouterBack, replace: mockRouterReplace }),
}))

vi.mock('@/lib/hooks/useTrip', () => ({
  useTrip: () => mockUseTrip(),
}))

// The step pages take a GPS fix silently at submit time (lib/context/LocationContext.tsx).
// Mocked like every other hook here so these tests stay about submission behaviour, and
// so the fix is a known value the payload assertions can check for.
const mockCapturePosition = vi.fn(async () => ({ lat: -26.09, lng: 28.13, accuracyM: 8 }))
vi.mock('@/lib/hooks/useLocationTrail', () => ({
  useLocationTrail: () => ({ capturePosition: mockCapturePosition, recordHere: vi.fn() }),
}))

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: mockNotify }),
}))

vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueueCheckpoint: mockEnqueueCheckpoint }),
}))

vi.mock('@/lib/api/checkpoints', () => ({
  submitCheckpoint: (...args: unknown[]) => mockSubmitCheckpoint(...args),
}))

// CameraCapture/SwipeToConfirm drive real camera/swipe-gesture APIs that are out of
// scope here (each already has its own dedicated test coverage) — stub them to simple
// controls so this suite only exercises CheckpointPageClient's own submit/queue wiring
// (Fix 3), mirroring the Button stub in LogExceptionPageClient's test. There is no GPS
// control left to stub: the fix is taken silently at submit (mocked above).

vi.mock('@/components/phase/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture }: { label: string; onCapture: (dataUrl: string) => void }) => (
    <button onClick={() => onCapture(`data:image/jpeg;base64,${label}`)}>{label}</button>
  ),
}))

vi.mock('@/components/phase/SwipeToConfirm', () => ({
  SwipeToConfirm: ({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) => (
    <button onClick={onConfirm} disabled={disabled}>{label}</button>
  ),
}))

function fillCaptures() {
  fireEvent.click(screen.getByText('Selfie'))
  fireEvent.click(screen.getByText('Cargo photo'))
}

describe('CheckpointPageClient offline queue (Fix 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' } })
  })

  it('submits directly and navigates to the hub on success (no queueing)', async () => {
    mockSubmitCheckpoint.mockResolvedValue({ id: 'cp-1' })

    render(<CheckpointPageClient />)
    fillCaptures()
    fireEvent.click(screen.getByText('Swipe to confirm'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockSubmitCheckpoint).toHaveBeenCalledWith('trip-1', expect.objectContaining({
      gpsLat: -26.09, gpsLng: 28.13,
    }))
    expect(mockEnqueueCheckpoint).not.toHaveBeenCalled()
  })

  it('on a network error, enqueues the checkpoint, shows the stored-on-device toast, and still advances to the hub', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new Error('network unreachable'))

    render(<CheckpointPageClient />)
    fillCaptures()
    fireEvent.click(screen.getByText('Swipe to confirm'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockEnqueueCheckpoint).toHaveBeenCalledWith('trip-1', expect.objectContaining({
      gpsLat: -26.09, gpsLng: 28.13, isDeviation: false,
    }))
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Checkpoint recorded', body: expect.stringContaining('stored on this device') }),
    )
  })

  it('on a 5xx, also enqueues and advances rather than showing the inline error', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new ApiError(503, 'service unavailable'))

    render(<CheckpointPageClient />)
    fillCaptures()
    fireEvent.click(screen.getByText('Swipe to confirm'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockEnqueueCheckpoint).toHaveBeenCalled()
    expect(screen.queryByText(/could not submit/i)).not.toBeInTheDocument()
  })

  it('on a 4xx, keeps the driver on the page with honest not-accepted copy and does not queue', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new ApiError(422, 'invalid checkpoint'))

    render(<CheckpointPageClient />)
    fillCaptures()
    fireEvent.click(screen.getByText('Swipe to confirm'))

    // Audit fix: the 4xx branch previously showed "check your connection" — misleading
    // exactly where the code knows retrying won't help.
    await waitFor(() =>
      expect(screen.getByText(/the checkpoint was not accepted/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/check your connection/i)).not.toBeInTheDocument()
    expect(mockEnqueueCheckpoint).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})

describe('CheckpointPageClient route-deviation checkbox (audit fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' } })
  })

  it('wraps the 16px checkbox in a label meeting the 44px minimum touch target', () => {
    render(<CheckpointPageClient />)

    const checkbox = screen.getByRole('checkbox', { name: /route deviation/i })
    const labelEl = checkbox.closest('label')

    // min-h-[44px] is the app's documented minimum touch target (Switch.tsx/Button.tsx);
    // the visual checkbox itself intentionally stays 16px (h-4 w-4).
    expect(labelEl).not.toBeNull()
    expect(labelEl?.className).toContain('min-h-[44px]')
    expect(checkbox.className).toContain('h-4')
  })
})
