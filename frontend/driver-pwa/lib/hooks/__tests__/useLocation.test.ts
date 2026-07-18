// frontend/driver-pwa/lib/hooks/__tests__/useLocation.test.ts
//
// Covers the evidentiary-integrity fix in lib/hooks/useLocation.ts: the browser path
// must read a real navigator.geolocation position, and the LINBRO_PARK stub may only
// ever surface as a NODE_ENV === 'development' convenience fallback — never in a
// production build, even when geolocation is unavailable or fails.
import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useLocation } from '../useLocation'

// Mocked per-test via vi.mocked() below — default browser/dev behaviour is
// non-native, so isNativePlatform() resolves false unless a test overrides it.
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn().mockReturnValue(false) },
}))

vi.mock('@capacitor/geolocation', () => ({
  Geolocation: { getCurrentPosition: vi.fn() },
}))

// jsdom does not implement navigator.geolocation at all, so each browser-path test
// installs its own stub and removes it afterwards rather than relying on a global one
// — a leftover stub would silently change behaviour for unrelated tests.
function stubBrowserGeolocation(geolocation: Geolocation | undefined) {
  Object.defineProperty(window.navigator, 'geolocation', {
    value: geolocation,
    configurable: true,
    writable: true,
  })
}

describe('useLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    stubBrowserGeolocation(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    stubBrowserGeolocation(undefined)
  })

  it('starts idle with no coords', () => {
    const { result } = renderHook(() => useLocation())

    expect(result.current.status).toBe('idle')
    expect(result.current.coords).toBeNull()
    expect(result.current.errorReason).toBeNull()
  })

  it('browser path: capture() calls navigator.geolocation.getCurrentPosition with high accuracy and a 10s timeout', async () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({
        coords: { latitude: -25.75, longitude: 28.19, accuracy: 12 },
      } as GeolocationPosition)
    })
    stubBrowserGeolocation({ getCurrentPosition } as unknown as Geolocation)

    const { result } = renderHook(() => useLocation())

    let captured: { latitude: number; longitude: number; accuracy: number } | null = null
    await act(async () => {
      captured = await result.current.capture()
    })

    expect(captured).toEqual({ latitude: -25.75, longitude: 28.19, accuracy: 12 })
    await waitFor(() => expect(result.current.status).toBe('captured'))
    expect(getCurrentPosition).toHaveBeenCalledWith(
      expect.any(Function),
      expect.any(Function),
      { enableHighAccuracy: true, timeout: 10_000 },
    )
  })

  it('browser path failure in a non-development build surfaces as an error, never the LINBRO_PARK stub', async () => {
    // Vitest itself runs with NODE_ENV === 'test' by default, which already exercises
    // this — stubbing it explicitly makes the "not development" intent unambiguous.
    vi.stubEnv('NODE_ENV', 'production')
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({ code: 2, message: 'position unavailable' } as GeolocationPositionError)
    })
    stubBrowserGeolocation({ getCurrentPosition } as unknown as Geolocation)

    const { result } = renderHook(() => useLocation())

    let captured: unknown = 'unset'
    await act(async () => {
      captured = await result.current.capture()
    })

    expect(captured).toBeNull()
    await waitFor(() => expect(result.current.status).toBe('error'))
    // Must never silently substitute the fabricated dev coordinate for a real reading.
    expect(result.current.coords).toBeNull()
    expect(result.current.errorReason).toBe('position_unavailable')
  })

  it('browser path failure in development falls back to the LINBRO_PARK dev stub', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({ code: 1, message: 'User denied Geolocation' } as GeolocationPositionError)
    })
    stubBrowserGeolocation({ getCurrentPosition } as unknown as Geolocation)

    const { result } = renderHook(() => useLocation())

    let captured: { latitude: number; longitude: number; accuracy: number } | null = null
    await act(async () => {
      captured = await result.current.capture()
    })

    expect(captured).toEqual({ latitude: -26.0942, longitude: 28.1342, accuracy: 5 })
    await waitFor(() => expect(result.current.status).toBe('captured'))
  })

  it('browser path with no navigator.geolocation at all in development falls back to the LINBRO_PARK dev stub', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    stubBrowserGeolocation(undefined)

    const { result } = renderHook(() => useLocation())

    let captured: { latitude: number; longitude: number; accuracy: number } | null = null
    await act(async () => {
      captured = await result.current.capture()
    })

    expect(captured).toEqual({ latitude: -26.0942, longitude: 28.1342, accuracy: 5 })
  })

  it('browser path with no navigator.geolocation at all in production surfaces as an unknown-reason error', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    stubBrowserGeolocation(undefined)

    const { result } = renderHook(() => useLocation())

    let captured: unknown = 'unset'
    await act(async () => {
      captured = await result.current.capture()
    })

    expect(captured).toBeNull()
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.coords).toBeNull()
    expect(result.current.errorReason).toBe('unknown')
  })

  it.each([
    [1, 'permission_denied'],
    [2, 'position_unavailable'],
    [3, 'timeout'],
  ] as const)('browser path maps GeolocationPositionError code %i to reason %s', async (code, reason) => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({ code, message: 'browser error' } as GeolocationPositionError)
    })
    stubBrowserGeolocation({ getCurrentPosition } as unknown as Geolocation)

    const { result } = renderHook(() => useLocation())

    await act(async () => {
      await result.current.capture()
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.errorReason).toBe(reason)
  })

  it('native failure path: capture() resolves to null, status becomes error, and the failure reason is logged', async () => {
    const { Capacitor } = await import('@capacitor/core')
    const { Geolocation } = await import('@capacitor/geolocation')
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)

    const permissionDenied = new Error('User denied Geolocation permission')
    vi.mocked(Geolocation.getCurrentPosition).mockRejectedValue(permissionDenied)

    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { result } = renderHook(() => useLocation())

    let captured: unknown = 'unset'
    await act(async () => {
      captured = await result.current.capture()
    })

    expect(captured).toBeNull()
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.errorReason).toBe('permission_denied')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[useLocation] capture failed (permission_denied):',
      permissionDenied,
    )
  })

  it.each([
    ['Location permission was denied', 'permission_denied'],
    ['location disabled', 'permission_denied'],
    ['Location services are not enabled', 'permission_denied'],
    ['location unavailable', 'position_unavailable'],
    ['request timed out', 'timeout'],
    ['Google Play Services not available', 'unknown'],
  ] as const)('native path maps Capacitor Android message %j to reason %s', async (message, reason) => {
    const { Capacitor } = await import('@capacitor/core')
    const { Geolocation } = await import('@capacitor/geolocation')
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true)
    vi.mocked(Geolocation.getCurrentPosition).mockRejectedValue(new Error(message))
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const { result } = renderHook(() => useLocation())

    await act(async () => {
      await result.current.capture()
    })

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.errorReason).toBe(reason)
  })
})
