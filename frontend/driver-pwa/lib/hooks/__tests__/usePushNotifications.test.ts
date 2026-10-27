// frontend/driver-pwa/lib/hooks/__tests__/usePushNotifications.test.ts
//
// The deep link built by this hook must match the real phase-step route shape
// (/trip/phase/[type]/step/[slug] — no trip id segment, see lib/phase/routes.ts and
// lib/constants/routes.ts's header note on the same constraint). A stale hand-rolled
// template with a trip id would 404 under the static export (every dynamic segment
// must be statically enumerable, and a real trip's UUID never is).
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePushNotifications } from '../usePushNotifications'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

const { native, platform, listeners, registerPushToken } = vi.hoisted(() => ({
  native: { value: false },
  platform: { value: 'android' },
  listeners: new Map<string, (payload: unknown) => void>(),
  registerPushToken: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value, getPlatform: () => platform.value },
}))

vi.mock('@/lib/api/push', () => ({ registerPushToken }))

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: vi.fn().mockResolvedValue({ receive: 'granted' }),
    register: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn((event: string, handler: (payload: unknown) => void) => {
      listeners.set(event, handler)
      return Promise.resolve({ remove: vi.fn().mockResolvedValue(undefined) })
    }),
  },
}))

import { PushNotifications } from '@capacitor/push-notifications'

beforeEach(() => {
  vi.clearAllMocks()
  native.value = false
  platform.value = 'android'
  listeners.clear()
  registerPushToken.mockResolvedValue(undefined)
})

describe('usePushNotifications', () => {
  it('routes a tapped gate-arrival notification to the phase step', async () => {
    native.value = true
    renderHook(() => usePushNotifications())
    await vi.waitFor(() => expect(listeners.has('pushNotificationActionPerformed')).toBe(true))

    act(() => listeners.get('pushNotificationActionPerformed')!({ actionId: 'tap', notification: { data: { type: 'GATE_ARRIVAL', phase_type: 'activation' } } }))

    expect(mockPush).toHaveBeenCalledWith('/trip/phase/activation/step/2-verification')
  })

  it('routes a tapped in_transit notification to the active trip when the phase has no steps', async () => {
    native.value = true
    renderHook(() => usePushNotifications())
    await vi.waitFor(() => expect(listeners.has('pushNotificationActionPerformed')).toBe(true))

    act(() => listeners.get('pushNotificationActionPerformed')!({ actionId: 'tap', notification: { data: { type: 'GATE_ARRIVAL', phase_type: 'in_transit' } } }))

    expect(mockPush).toHaveBeenCalledWith('/trips/active')
  })

  it('ignores a payload with an unknown phase type instead of throwing', async () => {
    native.value = true
    renderHook(() => usePushNotifications())
    await vi.waitFor(() => expect(listeners.has('pushNotificationReceived')).toBe(true))

    expect(() => listeners.get('pushNotificationReceived')!({ data: { type: 'GATE_ARRIVAL', phase_type: 'teleport' } })).not.toThrow()
    expect(() => listeners.get('pushNotificationReceived')!({ data: null })).not.toThrow()

    expect(mockPush).not.toHaveBeenCalled()
  })

  it('a device that refuses push services is logged, not crashed', async () => {
    native.value = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(PushNotifications.requestPermissions).mockRejectedValueOnce(new Error('no play services'))

    renderHook(() => usePushNotifications())

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Push notifications unavailable on this device', expect.any(Error)))
    expect(PushNotifications.register).not.toHaveBeenCalled()
  })

  it('sends the token the OS issues to the backend with this device\'s platform', async () => {
    native.value = true
    platform.value = 'ios'
    renderHook(() => usePushNotifications())
    await vi.waitFor(() => expect(listeners.has('registration')).toBe(true))

    act(() => listeners.get('registration')!({ value: 'apns-token-1' }))

    expect(registerPushToken).toHaveBeenCalledWith('apns-token-1', 'ios')
  })

  it('attaches the registration listener before asking the OS for a token', async () => {
    native.value = true
    renderHook(() => usePushNotifications())

    await vi.waitFor(() => expect(PushNotifications.register).toHaveBeenCalled())

    const order = vi.mocked(PushNotifications.addListener).mock.invocationCallOrder[0]
    expect(order).toBeLessThan(vi.mocked(PushNotifications.register).mock.invocationCallOrder[0])
    expect(vi.mocked(PushNotifications.addListener).mock.calls[0][0]).toBe('registration')
  })

  it('a token the server refuses is logged, not thrown', async () => {
    native.value = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    registerPushToken.mockRejectedValueOnce(new Error('offline'))
    renderHook(() => usePushNotifications())
    await vi.waitFor(() => expect(listeners.has('registration')).toBe(true))

    act(() => listeners.get('registration')!({ value: 'fcm-token-1' }))

    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('Could not register the push token with the server', expect.any(Error)))
  })

  it('does not post a token from an unknown platform', async () => {
    native.value = true
    platform.value = 'electron'
    renderHook(() => usePushNotifications())
    await vi.waitFor(() => expect(listeners.has('registration')).toBe(true))

    act(() => listeners.get('registration')!({ value: 'x' }))

    expect(registerPushToken).not.toHaveBeenCalled()
  })
})
