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
  // By role: the checklist above the swipe repeats these labels as plain list items.
  fireEvent.click(screen.getByRole('button', { name: 'Selfie' }))
  fireEvent.click(screen.getByRole('button', { name: 'Cargo photo' }))
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
    fireEvent.click(screen.getByText('Swipe to Confirm'))

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
    fireEvent.click(screen.getByText('Swipe to Confirm'))

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
    fireEvent.click(screen.getByText('Swipe to Confirm'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockEnqueueCheckpoint).toHaveBeenCalled()
    expect(screen.queryByText(/could not submit/i)).not.toBeInTheDocument()
  })

  it('on a 4xx, keeps the driver on the page with honest not-accepted copy and does not queue', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new ApiError(422, 'invalid checkpoint'))

    render(<CheckpointPageClient />)
    fillCaptures()
    fireEvent.click(screen.getByText('Swipe to Confirm'))

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

describe('CheckpointPageClient route-deviation switch (audit M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' } })
  })

  it('is a labelled switch with the 44px minimum touch target, not a 16px checkbox', () => {
    // Arrange / Act
    render(<CheckpointPageClient />)
    const toggle = screen.getByRole('switch', { name: /route deviation/i })

    // Assert — the switch's own root is the hit area (h-11 = 44px, Switch.tsx).
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(toggle).toHaveClass('h-11')
  })

  it('flips on tap and reads back as checked', () => {
    // Arrange
    render(<CheckpointPageClient />)
    const toggle = screen.getByRole('switch', { name: /route deviation/i })

    // Act
    fireEvent.click(toggle)

    // Assert
    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })
})

describe('CheckpointPageClient swipe placement (0px-wide swipe bug)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' } })
  })

  it('gives the swipe a full-width wrapper so it cannot collapse to zero width', () => {
    // jsdom does no layout, so the 0px width itself can't be measured here (it was found
    // in a real browser). This guards the structure that caused it: the track is w-full,
    // so its wrapper must be full width too, not a shrink-to-fit box in a centred column.
    // SwipeToConfirm is mocked as a plain button in this file; its direct parent is the
    // wrapper that collapsed the real track.
    render(<CheckpointPageClient />)

    const wrapper = screen.getByRole('button', { name: 'Swipe to Confirm' }).parentElement

    expect(wrapper).toHaveClass('w-full')
  })

  it('lists the selfie and cargo photo as still needed', () => {
    render(<CheckpointPageClient />)

    const list = screen.getByRole('list', { name: 'Needed to continue' })

    expect(list).toHaveTextContent('Selfie')
    expect(list).toHaveTextContent('Cargo photo')
  })
})
