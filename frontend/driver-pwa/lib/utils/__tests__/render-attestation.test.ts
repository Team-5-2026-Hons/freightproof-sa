// frontend/driver-pwa/lib/utils/__tests__/render-attestation.test.ts
//
// The attestation image is the receiver's signature artifact, so the things asserted here
// are evidential, not cosmetic: a missing fix must read as "unavailable" rather than as a
// blank, the instant must survive being read in another timezone, and a canvas that
// refuses a context must fail rather than emit an empty artifact.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderAttestation, formatPosition, formatSignedAt } from '../render-attestation'

const MOCK_PNG_DATA_URL = 'data:image/png;base64,YXR0ZXN0YXRpb24='
const SIGNED_AT = '2026-08-04T18:14:33.000Z'
const TRIP_ID = '7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a1b'

// jsdom ships no 2D canvas (node-canvas isn't installed) — same stub approach as
// SignaturePad.test.tsx. Recording the drawn text doubles as the assertion surface.
function stubCanvas(): { texts: string[]; restore: () => void } {
  const texts: string[] = []
  const ctx = {
    fillRect: vi.fn(),
    fillText: vi.fn((text: string) => { texts.push(text) }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    set fillStyle(_v: string) {},
    set strokeStyle(_v: string) {},
    set font(_v: string) {},
  }
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, 'getContext')
    .mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
  const toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, 'toDataURL')
    .mockReturnValue(MOCK_PNG_DATA_URL)

  return { texts, restore: () => { getContext.mockRestore(); toDataURL.mockRestore() } }
}

afterEach(() => { vi.restoreAllMocks() })

describe('formatPosition', () => {
  it('renders coordinates to six decimals with rounded accuracy', () => {
    const result = formatPosition({ lat: -26.10761234, lng: 28.05671234, accuracyM: 8.4 })

    expect(result).toBe('-26.107612, 28.056712  (±8 m)')
  })

  it('omits the accuracy clause when the platform reports none', () => {
    const result = formatPosition({ lat: -26.1, lng: 28.05, accuracyM: null })

    expect(result).toBe('-26.100000, 28.050000')
  })

  it('reads as explicitly unavailable rather than blank when there is no fix', () => {
    const result = formatPosition(null)

    expect(result).toBe('Location unavailable')
  })
})

describe('formatSignedAt', () => {
  it('returns an ISO form that is unambiguous across timezones', () => {
    const { iso } = formatSignedAt(SIGNED_AT)

    expect(iso).toBe(SIGNED_AT)
  })
})

describe('renderAttestation', () => {
  it('returns a PNG data URL carrying the time, location and trip', () => {
    const { texts } = stubCanvas()

    const result = renderAttestation({
      signedAt: SIGNED_AT,
      position: { lat: -26.107612, lng: 28.056712, accuracyM: 8 },
      tripId: TRIP_ID,
    })

    expect(result).toBe(MOCK_PNG_DATA_URL)
    expect(texts).toContain('DIGITAL PROOF OF DELIVERY')
    expect(texts).toContain(SIGNED_AT)
    expect(texts).toContain('-26.107612, 28.056712  (±8 m)')
    expect(texts).toContain(TRIP_ID)
  })

  it('still signs, marking the location unavailable, when there is no fix', () => {
    const { texts } = stubCanvas()

    const result = renderAttestation({ signedAt: SIGNED_AT, position: null, tripId: TRIP_ID })

    expect(result).toBe(MOCK_PNG_DATA_URL)
    expect(texts).toContain('Location unavailable')
  })

  it('returns null rather than an empty artifact when no 2D context is available', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)

    const result = renderAttestation({ signedAt: SIGNED_AT, position: null, tripId: TRIP_ID })

    expect(result).toBeNull()
  })
})
