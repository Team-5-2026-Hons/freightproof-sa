// frontend/driver-pwa/lib/api/__tests__/geocode.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const LAT = -26.09
const LNG = 28.13

describe('reverseGeocode', () => {
  const originalKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = originalKey
  })

  it('returns null without warning when the API key is unset', async () => {
    delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { reverseGeocode } = await import('../geocode')

    const result = await reverseGeocode(LAT, LNG)

    expect(result).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('returns the formatted address on a successful response', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            status: 'OK',
            results: [{ formatted_address: '1 Gate Road, Johannesburg, South Africa' }],
          }),
      }),
    )
    const { reverseGeocode } = await import('../geocode')

    const result = await reverseGeocode(LAT, LNG)

    expect(result).toBe('1 Gate Road, Johannesburg, South Africa')
  })

  it('returns null and warns when the HTTP response is not ok', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}),
      }),
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { reverseGeocode } = await import('../geocode')

    const result = await reverseGeocode(LAT, LNG)

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('returns null and warns when the Google API status is not OK', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ status: 'ZERO_RESULTS', results: [] }),
      }),
    )
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { reverseGeocode } = await import('../geocode')

    const result = await reverseGeocode(LAT, LNG)

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })

  it('returns null and warns when fetch throws', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = 'test-key'
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { reverseGeocode } = await import('../geocode')

    const result = await reverseGeocode(LAT, LNG)

    expect(result).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })
})
