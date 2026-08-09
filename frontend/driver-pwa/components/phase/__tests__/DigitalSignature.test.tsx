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
import type { AttestationFields } from '@/lib/utils/render-attestation'

const MOCK_PNG_DATA_URL = 'data:image/png;base64,YXR0ZXN0YXRpb24='
const TRIP_ID = '7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a1b'
const RECIPIENT_NAME = 'Nomsa Dlamini'
const RECIPIENT_ID = '9202204720082'
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

// Forwards its argument rather than discarding it — the fields reaching the renderer are
// exactly what the artifact ends up asserting about the delivery, so they have to be
// assertable here.
const renderAttestation = vi.fn<(fields: AttestationFields) => string | null>()
vi.mock('@/lib/utils/render-attestation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils/render-attestation')>()
  return { ...actual, renderAttestation: (fields: AttestationFields) => renderAttestation(fields) }
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
    render(<DigitalSignature tripId={TRIP_ID} dataUrl={null} recipientName={RECIPIENT_NAME} recipientIdNumber={RECIPIENT_ID} onSign={vi.fn()} />)

    expect(capturePosition).not.toHaveBeenCalled()
  })

  it('captures the fix at the swipe and hands back the rendered attestation', async () => {
    const onSign = vi.fn()
    render(<DigitalSignature tripId={TRIP_ID} dataUrl={null} recipientName={RECIPIENT_NAME} recipientIdNumber={RECIPIENT_ID} onSign={onSign} />)

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
    render(<DigitalSignature tripId={TRIP_ID} dataUrl={null} recipientName={RECIPIENT_NAME} recipientIdNumber={RECIPIENT_ID} onSign={onSign} />)

    await swipe()

    expect(onSign).toHaveBeenCalledTimes(1)
    expect(onSign.mock.calls[0][0].position).toBeNull()
  })

  it('refuses to sign, and tells the receiver, when the artifact cannot be rendered', async () => {
    renderAttestation.mockReturnValue(null)
    const onSign = vi.fn()
    render(<DigitalSignature tripId={TRIP_ID} dataUrl={null} recipientName={RECIPIENT_NAME} recipientIdNumber={RECIPIENT_ID} onSign={onSign} />)

    await swipe()

    expect(onSign).not.toHaveBeenCalled()
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
  })
})

describe('DigitalSignature — the receiver identity gate', () => {
  // An attestation that cannot name its signer is the weakest possible proof of delivery,
  // so no route through this component may reach onSign without both fields.
  //
  // These drive the keyboard path, which SwipeToConfirm blocks itself when `disabled` —
  // so what they actually prove is that the control ends up disabled, and they would
  // still pass if DigitalSignature's own early-return backstop were deleted (verified by
  // removing it and watching them stay green). That backstop is defence-in-depth against
  // a future change to either the prop or SwipeToConfirm's locking, and it is not
  // observable from out here. These tests fence the behaviour that IS observable: no
  // identity, no signature, by any path a receiver can actually take.
  it.each([
    ['both missing', null, null],
    ['no name', null, RECIPIENT_ID],
    ['no ID number', RECIPIENT_NAME, null],
    ['whitespace only', '   ', '   '],
  ])('does not sign when %s', async (_case, name, idNumber) => {
    const onSign = vi.fn()
    render(
      <DigitalSignature
        tripId={TRIP_ID} dataUrl={null}
        recipientName={name} recipientIdNumber={idNumber}
        onSign={onSign}
      />,
    )

    await swipe()

    expect(onSign).not.toHaveBeenCalled()
    expect(capturePosition).not.toHaveBeenCalled()
  })

  it('draws the receiver name and ID into the attestation, trimmed', async () => {
    render(
      <DigitalSignature
        tripId={TRIP_ID} dataUrl={null}
        recipientName={`  ${RECIPIENT_NAME}  `} recipientIdNumber={`  ${RECIPIENT_ID}  `}
        onSign={vi.fn()}
      />,
    )

    await swipe()

    // Trimmed: a trailing space from a phone keyboard must not be baked into the artifact
    // as part of the receiver's name.
    expect(renderAttestation).toHaveBeenCalledTimes(1)
    expect(renderAttestation.mock.calls[0][0]).toMatchObject({
      recipientName: RECIPIENT_NAME,
      recipientIdNumber: RECIPIENT_ID,
    })
  })
})

describe('DigitalSignature — already signed', () => {
  it('shows the attestation and offers no second swipe', () => {
    render(<DigitalSignature tripId={TRIP_ID} dataUrl={MOCK_PNG_DATA_URL} recipientName={RECIPIENT_NAME} recipientIdNumber={RECIPIENT_ID} onSign={vi.fn()} />)

    expect(screen.getByAltText('Digital proof of delivery')).toHaveAttribute('src', MOCK_PNG_DATA_URL)
    expect(screen.queryByRole('slider', { name: 'Swipe to digitally sign' })).toBeNull()
  })
})
