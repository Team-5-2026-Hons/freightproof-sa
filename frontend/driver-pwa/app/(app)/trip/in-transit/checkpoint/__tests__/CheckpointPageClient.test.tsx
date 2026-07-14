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

vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: mockNotify }),
}))

vi.mock('@/lib/hooks/useOfflineQueue', () => ({
  useOfflineQueue: () => ({ enqueueCheckpoint: mockEnqueueCheckpoint }),
}))

vi.mock('@/lib/api/checkpoints', () => ({
  submitCheckpoint: (...args: unknown[]) => mockSubmitCheckpoint(...args),
}))

// GpsCapture/CameraCapture/HoldButton drive real camera/GPS/hold-gesture APIs that are
// out of scope here (each already has its own dedicated test coverage) — stub them to
// simple controls so this suite only exercises CheckpointPageClient's own submit/queue
// wiring (Fix 3), mirroring the Button stub in LogExceptionPageClient's test.
vi.mock('@/components/handshake/GpsCapture', () => ({
  GpsCapture: ({ onCapture }: { onCapture: (lat: number, lng: number) => void }) => (
    <button onClick={() => onCapture(-29.85, 31.02)}>Capture GPS</button>
  ),
}))

vi.mock('@/components/handshake/CameraCapture', () => ({
  CameraCapture: ({ label, onCapture }: { label: string; onCapture: (dataUrl: string) => void }) => (
    <button onClick={() => onCapture(`data:image/jpeg;base64,${label}`)}>{label}</button>
  ),
}))

vi.mock('@/components/handshake/HoldButton', () => ({
  HoldButton: ({ label, onConfirm, disabled }: { label: string; onConfirm: () => void; disabled?: boolean }) => (
    <button onClick={onConfirm} disabled={disabled}>{label}</button>
  ),
}))

function fillCaptures() {
  fireEvent.click(screen.getByText('Capture GPS'))
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
    fireEvent.click(screen.getByText('Hold to confirm'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockSubmitCheckpoint).toHaveBeenCalledWith('trip-1', expect.objectContaining({
      gpsLat: -29.85, gpsLng: 31.02,
    }))
    expect(mockEnqueueCheckpoint).not.toHaveBeenCalled()
  })

  it('on a network error, enqueues the checkpoint, shows the stored-on-device toast, and still advances to the hub', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new Error('network unreachable'))

    render(<CheckpointPageClient />)
    fillCaptures()
    fireEvent.click(screen.getByText('Hold to confirm'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockEnqueueCheckpoint).toHaveBeenCalledWith('trip-1', expect.objectContaining({
      gpsLat: -29.85, gpsLng: 31.02, isDeviation: false,
    }))
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'success', title: 'Checkpoint recorded', body: expect.stringContaining('stored on this device') }),
    )
  })

  it('on a 5xx, also enqueues and advances rather than showing the inline error', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new ApiError(503, 'service unavailable'))

    render(<CheckpointPageClient />)
    fillCaptures()
    fireEvent.click(screen.getByText('Hold to confirm'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockEnqueueCheckpoint).toHaveBeenCalled()
    expect(screen.queryByText(/could not submit/i)).not.toBeInTheDocument()
  })

  it('on a 4xx, keeps the driver on the page with the inline error and does not queue', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new ApiError(422, 'invalid checkpoint'))

    render(<CheckpointPageClient />)
    fillCaptures()
    fireEvent.click(screen.getByText('Hold to confirm'))

    await waitFor(() => expect(screen.getByText(/could not submit — check your connection/i)).toBeInTheDocument())
    expect(mockEnqueueCheckpoint).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})
