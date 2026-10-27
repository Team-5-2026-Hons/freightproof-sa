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
  fireEvent.click(screen.getByRole('button', { name: 'Cargo photo' }))
}

describe('CheckpointPageClient offline queue (Fix 3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' } })
    mockEnqueueCheckpoint.mockReturnValue(true)
  })

  it('submits directly and navigates to the hub on success (no queueing)', async () => {
    mockSubmitCheckpoint.mockResolvedValue({ id: 'cp-1' })

    render(<CheckpointPageClient />)
    fillCaptures()
    fireEvent.click(screen.getByText('Swipe to Log Checkpoint'))

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
    fireEvent.click(screen.getByText('Swipe to Log Checkpoint'))

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
    fireEvent.click(screen.getByText('Swipe to Log Checkpoint'))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(mockEnqueueCheckpoint).toHaveBeenCalled()
    expect(screen.queryByText(/could not submit/i)).not.toBeInTheDocument()
  })

  it('on a 4xx, keeps the driver on the page with honest not-accepted copy and does not queue', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new ApiError(422, 'invalid checkpoint'))

    render(<CheckpointPageClient />)
    fillCaptures()
    fireEvent.click(screen.getByText('Swipe to Log Checkpoint'))

    await waitFor(() =>
      expect(screen.getByText(/the checkpoint was not accepted/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/check your connection/i)).not.toBeInTheDocument()
    expect(mockEnqueueCheckpoint).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})

describe('CheckpointPageClient when the phone cannot store the checkpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' } })
    mockEnqueueCheckpoint.mockReturnValue(false)
  })

  async function swipeAndSettle() {
    render(<CheckpointPageClient />)
    fillCaptures()
    fireEvent.click(screen.getByText('Swipe to Log Checkpoint'))
    await waitFor(() => expect(mockEnqueueCheckpoint).toHaveBeenCalled())
  }

  it('on a network error, says so and stays put instead of claiming the evidence is stored', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new Error('network unreachable'))

    await swipeAndSettle()

    expect(await screen.findByText(/couldn.t save on this phone/i)).toBeInTheDocument()
    expect(mockNotify).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('keeps the captured evidence so the driver can simply try again', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new Error('network unreachable'))

    await swipeAndSettle()
    await screen.findByText(/couldn.t save on this phone/i)

    expect(screen.getByRole('button', { name: 'Swipe to Log Checkpoint' })).toBeEnabled()
  })

  it('clears the storage error on the next attempt, and moves on once it is stored', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new Error('network unreachable'))
    await swipeAndSettle()
    await screen.findByText(/couldn.t save on this phone/i)
    mockEnqueueCheckpoint.mockReturnValue(true)

    fireEvent.click(screen.getByRole('button', { name: 'Swipe to Log Checkpoint' }))

    await waitFor(() => expect(mockRouterPush).toHaveBeenCalledWith(ROUTES.inTransit))
    expect(screen.queryByText(/couldn.t save on this phone/i)).not.toBeInTheDocument()
  })

  it('on a custody conflict, does not leave for home as though the checkpoint were kept', async () => {
    mockSubmitCheckpoint.mockRejectedValue(new ApiError(409, 'Captured before the handover', undefined, {
      code: 'CUSTODY_CONTEXT_CHANGED', requestId: null, currentVersion: null, evidenceId: null,
    }))

    await swipeAndSettle()

    expect(await screen.findByText(/couldn.t save on this phone/i)).toBeInTheDocument()
    expect(mockNotify).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})

describe('CheckpointPageClient route-deviation switch (audit M5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' } })
  })

  it('is a labelled switch with the 44px minimum touch target, not a 16px checkbox', () => {
    render(<CheckpointPageClient />)
    const toggle = screen.getByRole('switch', { name: /route deviation/i })

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(toggle).toHaveClass('h-11')
  })

  it('flips on tap and reads back as checked', () => {
    render(<CheckpointPageClient />)
    const toggle = screen.getByRole('switch', { name: /route deviation/i })

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute('aria-checked', 'true')
  })
})

describe('CheckpointPageClient swipe placement (0px-wide swipe bug)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' } })
  })

  it('gives the swipe a full-width wrapper so it cannot collapse to zero width', () => {
    render(<CheckpointPageClient />)

    const wrapper = screen.getByRole('button', { name: 'Swipe to Log Checkpoint' }).parentElement

    expect(wrapper).toHaveClass('w-full')
  })

  it('lists the cargo photo as still needed, and nothing else', () => {
    render(<CheckpointPageClient />)

    const list = screen.getByRole('list', { name: 'Needed to continue' })

    expect(list).toHaveTextContent('Cargo photo')
    expect(list).not.toHaveTextContent('Selfie')
  })
})

describe('CheckpointPageClient — cargo photo only (overhaul 6.2)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseTrip.mockReturnValue({ trip: { id: 'trip-1' } })
  })

  it('test_asks_for_no_selfie', () => {
    render(<CheckpointPageClient />)

    expect(screen.queryByRole('button', { name: 'Selfie' })).toBeNull()
  })

  it('test_is_ready_with_the_cargo_photo_alone', () => {
    render(<CheckpointPageClient />)

    fireEvent.click(screen.getByRole('button', { name: 'Cargo photo' }))

    expect(screen.getByRole('button', { name: 'Swipe to Log Checkpoint' })).toBeEnabled()
  })

  it('test_submits_no_selfie', async () => {
    mockSubmitCheckpoint.mockResolvedValue({ id: 'cp-1' })
    render(<CheckpointPageClient />)
    fireEvent.click(screen.getByRole('button', { name: 'Cargo photo' }))

    fireEvent.click(screen.getByRole('button', { name: 'Swipe to Log Checkpoint' }))

    await waitFor(() => expect(mockSubmitCheckpoint).toHaveBeenCalled())
    expect(mockSubmitCheckpoint.mock.calls[0][1]).not.toHaveProperty('selfieDataUrl')
  })
})
