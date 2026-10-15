// frontend/driver-pwa/lib/ocr/__tests__/readSeal.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsNative, mockDetectText } = vi.hoisted(() => ({
  mockIsNative: vi.fn(),
  mockDetectText: vi.fn(),
}))
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => mockIsNative() } }))
vi.mock('@capacitor-community/image-to-text', () => ({
  Ocr: { detectText: (...args: unknown[]) => mockDetectText(...args) },
}))

import { canReadSeals, readSealFromPhoto, SEAL_OCR_TIMEOUT_MS } from '../readSeal'

const PHOTO = 'data:image/jpeg;base64,AAAA'

function detections(...lines: string[]) {
  return { textDetections: lines.map((text) => ({ text })) }
}

describe('readSealFromPhoto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsNative.mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is unavailable in the browser and never calls the plugin', async () => {
    mockIsNative.mockReturnValue(false)

    expect(await readSealFromPhoto(PHOTO)).toEqual({ kind: 'unavailable' })
    expect(mockDetectText).not.toHaveBeenCalled()
  })

  it('sends the base64 without the data-URL prefix and returns the one number it found', async () => {
    mockDetectText.mockResolvedValue(detections('TYDENBROOKS', 'AB-1234'))

    expect(await readSealFromPhoto(PHOTO)).toEqual({ kind: 'found', value: 'AB-1234' })
    expect(mockDetectText).toHaveBeenCalledWith({ base64: 'AAAA' })
  })

  it('reports none when nothing seal-shaped was read', async () => {
    mockDetectText.mockResolvedValue(detections('NO SEAL HERE'))

    expect(await readSealFromPhoto(PHOTO)).toEqual({ kind: 'none' })
  })

  it('reports none rather than guess between two different numbers', async () => {
    mockDetectText.mockResolvedValue(detections('AB-1234', 'CD-5678'))

    expect(await readSealFromPhoto(PHOTO)).toEqual({ kind: 'none' })
  })

  it('is unavailable when the plugin throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockDetectText.mockRejectedValue(new Error('ML Kit not ready'))

    expect(await readSealFromPhoto(PHOTO)).toEqual({ kind: 'unavailable' })
  })

  it('gives up after the timeout so the driver is never kept waiting', async () => {
    vi.useFakeTimers()
    mockDetectText.mockReturnValue(new Promise(() => {}))

    const pending = readSealFromPhoto(PHOTO)
    await vi.advanceTimersByTimeAsync(SEAL_OCR_TIMEOUT_MS)

    expect(await pending).toEqual({ kind: 'unavailable' })
  })
})

describe('canReadSeals', () => {
  it('is true only on the native app', () => {
    mockIsNative.mockReturnValue(true)
    expect(canReadSeals()).toBe(true)

    mockIsNative.mockReturnValue(false)
    expect(canReadSeals()).toBe(false)
  })
})
