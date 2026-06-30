// frontend/driver-pwa/lib/hooks/__tests__/useLocation.test.ts
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

describe('useLocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts idle with no coords', () => {
    const { result } = renderHook(() => useLocation())

    expect(result.current.status).toBe('idle')
    expect(result.current.coords).toBeNull()
  })

  it('browser/non-native fallback: capture() resolves to LINBRO_PARK coords and status becomes captured', async () => {
    const { Capacitor } = await import('@capacitor/core')
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false)

    const { result } = renderHook(() => useLocation())

    let captured: { latitude: number; longitude: number; accuracy: number } | null = null
    await act(async () => {
      captured = await result.current.capture()
    })

    expect(captured).toEqual({ latitude: -26.0942, longitude: 28.1342, accuracy: 5 })
    await waitFor(() => expect(result.current.status).toBe('captured'))
    expect(result.current.coords).toEqual({ latitude: -26.0942, longitude: 28.1342, accuracy: 5 })
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
    expect(consoleErrorSpy).toHaveBeenCalledWith('[useLocation] capture failed:', permissionDenied)
  })
})
