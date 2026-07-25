// frontend/driver-pwa/components/handshake/__tests__/CameraCapture.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CameraCapture } from '../CameraCapture'

const SAMPLE_DATA_URL = 'data:image/png;base64,iVBORw0KGgo='

// The component surfaces capture failures via useToast — mock the hook (same pattern
// as the page-client suites) so these tests don't need a full ToastProvider tree.
const mockNotify = vi.fn()
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify: mockNotify }),
}))

// Drive the NATIVE branch deterministically: platform reports native, and getPhoto is a
// controllable mock so each test can simulate the Capacitor bridge's real rejection
// messages (see classifyCameraFailure in the component).
const mockIsNativePlatform = vi.fn()
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mockIsNativePlatform() },
}))

const mockGetPhoto = vi.fn()
vi.mock('@capacitor/camera', () => ({
  Camera: { getPhoto: (...args: unknown[]) => mockGetPhoto(...args) },
  CameraResultType: { DataUrl: 'dataUrl' },
  CameraSource: { Camera: 'CAMERA' },
}))

// Task 2c: the captured photo must read as a framed control, not merge with the page. The image
// sits in a fixed aspect-video frame and fills it via object-cover (no free-height max-h-48).

describe('CameraCapture captured branch', () => {
  it('renders the image with object-cover inside an aspect-video frame', () => {
    render(<CameraCapture label="Exit gate photo" dataUrl={SAMPLE_DATA_URL} onCapture={vi.fn()} />)

    const img = screen.getByAltText('Exit gate photo')

    expect(img.className).toContain('object-cover')
    expect(img.className).not.toContain('max-h-48')
    expect(img.closest('.aspect-video')).not.toBeNull()
  })
})

// Audit fix: handleCapture previously had try/finally with NO catch — a permission
// denial or any native failure silently reset the button with zero driver feedback.

describe('CameraCapture native capture failures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsNativePlatform.mockReturnValue(true)
  })

  it('passes the downscale cap and quality to the native camera and forwards the result', async () => {
    const onCapture = vi.fn()
    mockGetPhoto.mockResolvedValue({ dataUrl: SAMPLE_DATA_URL })

    render(<CameraCapture label="Selfie" dataUrl={null} onCapture={onCapture} />)
    fireEvent.click(screen.getByText('Tap to photograph'))

    await waitFor(() => expect(onCapture).toHaveBeenCalledWith(SAMPLE_DATA_URL))
    expect(mockGetPhoto).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1600, quality: 70 }),
    )
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it('shows the settings-pointing toast when camera permission is denied', async () => {
    // Exact string the Capacitor camera plugin rejects with on Android/iOS.
    mockGetPhoto.mockRejectedValue(new Error('User denied access to camera'))

    render(<CameraCapture label="Selfie" dataUrl={null} onCapture={vi.fn()} />)
    fireEvent.click(screen.getByText('Tap to photograph'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'error',
          title: 'Camera access is blocked',
          body: expect.stringContaining('settings'),
        }),
      ),
    )
  })

  it('stays silent when the driver cancels the camera on purpose', async () => {
    const onCapture = vi.fn()
    // Exact string the plugin rejects with when the user backs out of the camera.
    mockGetPhoto.mockRejectedValue(new Error('User cancelled photos app'))

    render(<CameraCapture label="Selfie" dataUrl={null} onCapture={onCapture} />)
    fireEvent.click(screen.getByText('Tap to photograph'))

    // The button must return to its idle state (finally ran) with no toast fired —
    // a cancel is an intentional action, not a failure.
    await waitFor(() => expect(screen.getByText('Tap to photograph')).toBeInTheDocument())
    expect(mockNotify).not.toHaveBeenCalled()
    expect(onCapture).not.toHaveBeenCalled()
  })

  it('shows a generic failure toast for any other camera error', async () => {
    mockGetPhoto.mockRejectedValue(new Error('Out of memory'))

    render(<CameraCapture label="Selfie" dataUrl={null} onCapture={vi.fn()} />)
    fireEvent.click(screen.getByText('Tap to photograph'))

    await waitFor(() =>
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'error', title: 'Could not add the photo' }),
      ),
    )
  })
})
