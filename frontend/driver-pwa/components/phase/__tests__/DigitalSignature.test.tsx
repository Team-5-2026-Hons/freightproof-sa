// frontend/driver-pwa/components/phase/__tests__/DigitalSignature.test.tsx
//
// The receiver's signature is now a swipe, so what matters evidentially is that the fix
// is taken AT the swipe (not on mount, which would attest to where the phone was when the
// screen opened), that a phone with no fix still signs, and that a device which cannot
// render the artifact refuses to sign rather than emitting an empty one.
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DigitalSignature } from '../DigitalSignature'
import type { DriverPosition } from '@/lib/types/location'

const MOCK_PNG_DATA_URL = 'data:image/png;base64,YXR0ZXN0YXRpb24='
const TRIP_ID = '7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a1b'
const FIX: DriverPosition = { lat: -26.107612, lng: 28.056712, accuracyM: 8 }
// SwipeToConfirm's settle delay before it hands off to onConfirm.
const SWIPE_SETTLE_MS = 180

const capturePosition = vi.fn<() => Promise<DriverPosition | null>>()
const notify = vi.fn()

vi.mock('@/lib/hooks/useLocationTrail', () => ({
  useLocationTrail: () => ({ capturePosition, recordHere: vi.fn() }),
}))
vi.mock('@/lib/hooks/useToast', () => ({
  useToast: () => ({ notify }),
}))

const renderAttestation = vi.fn<() => string | null>()
vi.mock('@/lib/utils/render-attestation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/render-attestation')>()
  return { ...actual, renderAttestation: () => renderAttestation() }
})

beforeEach(() => {
  vi.useFakeTimers()
  capturePosition.mockResolvedValue(FIX)
  renderAttestation.mockReturnValue(MOCK_PNG_DATA_URL)
})
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  cleanup()
})

// Drives SwipeToConfirm through its keyboard path (arm, then confirm) rather than a real
// pointer drag — the gesture itself is covered in SwipeToConfirm.test.tsx.
async function swipe(): Promise<void> {
  const slider = screen.getByRole('slider', { name: 'Swipe to digitally sign' })
  fireEvent.keyDown(slider, { key: 'Enter' })
  fireEvent.keyDown(slider, { key: 'Enter' })
  await act(async () => {
    vi.advanceTimersByTime(SWIPE_SETTLE_MS)
  })
}

describe('DigitalSignature — signing', () => {
  it('does not take a position until the receiver actually swipes', () => {
    render(<DigitalSignature tripId={TRIP_ID} dataUrl={null} onSign={vi.fn()} />)

    expect(capturePosition).not.toHaveBeenCalled()
  })

  it('captures the fix at the swipe and hands back the rendered attestation', async () => {
    const onSign = vi.fn()
    render(<DigitalSignature tripId={TRIP_ID} dataUrl={null} onSign={onSign} />)

    await swipe()

    expect(capturePosition).toHaveBeenCalledTimes(1)
    expect(onSign).toHaveBeenCalledTimes(1)
    expect(onSign.mock.calls[0][0]).toMatchObject({
      dataUrl: MOCK_PNG_DATA_URL,
      position: FIX,
    })
    expect(typeof onSign.mock.calls[0][0].signedAt).toBe('string')
  })

  it('still signs with a null position when the phone cannot produce a fix', async () => {
    capturePosition.mockResolvedValue(null)
    const onSign = vi.fn()
    render(<DigitalSignature tripId={TRIP_ID} dataUrl={null} onSign={onSign} />)

    await swipe()

    expect(onSign).toHaveBeenCalledTimes(1)
    expect(onSign.mock.calls[0][0].position).toBeNull()
  })

  it('refuses to sign, and tells the receiver, when the artifact cannot be rendered', async () => {
    renderAttestation.mockReturnValue(null)
    const onSign = vi.fn()
    render(<DigitalSignature tripId={TRIP_ID} dataUrl={null} onSign={onSign} />)

    await swipe()

    expect(onSign).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
  })
})

describe('DigitalSignature — already signed', () => {
  it('shows the attestation and offers no second swipe', () => {
    render(<DigitalSignature tripId={TRIP_ID} dataUrl={MOCK_PNG_DATA_URL} onSign={vi.fn()} />)

    expect(screen.getByAltText('Digital proof of delivery')).toHaveAttribute('src', MOCK_PNG_DATA_URL)
    expect(screen.queryByRole('slider', { name: 'Swipe to digitally sign' })).toBeNull()
  })
})
