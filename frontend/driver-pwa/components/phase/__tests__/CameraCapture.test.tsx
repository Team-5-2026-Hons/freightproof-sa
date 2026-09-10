// frontend/driver-pwa/components/phase/__tests__/CameraCapture.test.tsx
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

// FP-150 hardening. Two gaps this suite had: the browser file-input branch had NO
// coverage at all (every test above drives the native Capacitor path), and a driver who
// denied camera permission was dead-ended on a toast with no way to attach a photo.

/**
 * Captures the detached <input type="file"> the component builds and clicks, so a test
 * can inspect it and drive its change handler. Returns a getter, since the element does
 * not exist until a capture is attempted.
 */
function interceptFileInput(): () => HTMLInputElement | null {
  let captured: HTMLInputElement | null = null
  const realCreateElement = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
    const el = realCreateElement(tag)
    if (tag === 'input') {
      captured = el as HTMLInputElement
      // jsdom would otherwise try to open a file dialog it has no implementation for.
      ;(el as HTMLInputElement).click = vi.fn()
    }
    return el
  })
  return () => captured
}

function pickFile(input: HTMLInputElement, file: File): void {
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  input.onchange?.(new Event('change'))
}

describe('CameraCapture browser fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    mockIsNativePlatform.mockReturnValue(false)
  })

  it('opens a rear-camera file picker instead of the Capacitor plugin', () => {
    const getInput = interceptFileInput()

    render(<CameraCapture label="Damage photo" dataUrl={null} onCapture={vi.fn()} />)
    fireEvent.click(screen.getByText('Tap to photograph'))

    const input = getInput()
    expect(input).not.toBeNull()
    expect(input!.type).toBe('file')
    expect(input!.accept).toBe('image/*')
    // The hint that makes a phone open the camera rather than the gallery.
    expect(input!.capture).toBe('environment')
    expect(input!.click).toHaveBeenCalled()
    expect(mockGetPhoto).not.toHaveBeenCalled()
  })

  it('hands the page a data URL for the photo the driver picked', async () => {
    const onCapture = vi.fn()
    const getInput = interceptFileInput()
    // Decode succeeds; jsdom has no canvas 2D context, so the component falls through to
    // its FileReader path — the same route a WebView takes when compression fails.
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 4000, height: 3000, close: vi.fn(),
    }))

    render(<CameraCapture label="Damage photo" dataUrl={null} onCapture={onCapture} />)
    fireEvent.click(screen.getByText('Tap to photograph'))
    pickFile(getInput()!, new File(['jpeg-bytes'], 'damage.jpg', { type: 'image/jpeg' }))

    await waitFor(() => expect(onCapture).toHaveBeenCalled())
    expect(onCapture.mock.calls[0][0]).toMatch(/^data:/)
  })

  it('does nothing when the driver opens the picker and cancels', async () => {
    const onCapture = vi.fn()
    const getInput = interceptFileInput()

    render(<CameraCapture label="Damage photo" dataUrl={null} onCapture={onCapture} />)
    fireEvent.click(screen.getByText('Tap to photograph'))
    const input = getInput()!
    Object.defineProperty(input, 'files', { value: [], configurable: true })
    input.onchange?.(new Event('change'))

    expect(onCapture).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })
})

describe('CameraCapture falls back to the picker when the native camera cannot open', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    mockIsNativePlatform.mockReturnValue(true)
  })

  it('offers the picker after a permission denial instead of dead-ending on a toast', async () => {
    mockGetPhoto.mockRejectedValue(new Error('User denied access to camera'))
    const getInput = interceptFileInput()

    render(<CameraCapture label="Damage photo" dataUrl={null} onCapture={vi.fn()} />)
    fireEvent.click(screen.getByText('Tap to photograph'))

    // The driver is told how to fix it AND given a way through right now — a driver at a
    // gate cannot stop to change OS settings, and the photo is the evidence.
    await waitFor(() => expect(screen.getByText('Choose a photo instead')).toBeInTheDocument())
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'error', title: 'Camera access is blocked' }),
    )

    fireEvent.click(screen.getByText('Choose a photo instead'))

    // Second tap goes to the file picker; re-asking the plugin would only reproduce the
    // same refusal.
    expect(getInput()).not.toBeNull()
    expect(mockGetPhoto).toHaveBeenCalledTimes(1)
  })

  it('offers the picker on a device whose camera fails for any other reason', async () => {
    // A device with no camera at all surfaces here like any other plugin error.
    mockGetPhoto.mockRejectedValue(new Error('No camera available'))

    render(<CameraCapture label="Damage photo" dataUrl={null} onCapture={vi.fn()} />)
    fireEvent.click(screen.getByText('Tap to photograph'))

    await waitFor(() => expect(screen.getByText('Choose a photo instead')).toBeInTheDocument())
  })

  it('keeps offering the camera after a deliberate cancel', async () => {
    mockGetPhoto.mockRejectedValue(new Error('User cancelled photos app'))

    render(<CameraCapture label="Damage photo" dataUrl={null} onCapture={vi.fn()} />)
    fireEvent.click(screen.getByText('Tap to photograph'))

    // Backing out is not a failure — the control must not degrade to a picker for it.
    await waitFor(() => expect(screen.getByText('Tap to photograph')).toBeInTheDocument())
    expect(screen.queryByText('Choose a photo instead')).not.toBeInTheDocument()
  })
})

describe('CameraCapture retake', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
    mockIsNativePlatform.mockReturnValue(true)
  })

  it('reopens the camera and replaces the photo when the driver retakes', async () => {
    const onCapture = vi.fn()
    const RETAKEN = 'data:image/jpeg;base64,retaken=='
    mockGetPhoto.mockResolvedValue({ dataUrl: RETAKEN })

    render(<CameraCapture label="Damage photo" dataUrl={SAMPLE_DATA_URL} onCapture={onCapture} />)
    fireEvent.click(screen.getByText('Retake'))

    await waitFor(() => expect(onCapture).toHaveBeenCalledWith(RETAKEN))
  })
})
