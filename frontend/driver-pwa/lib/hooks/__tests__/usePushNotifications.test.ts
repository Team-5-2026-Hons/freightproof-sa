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

const { native, listeners } = vi.hoisted(() => ({
  native: { value: false },
  listeners: new Map<string, (payload: unknown) => void>(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => native.value },
}))

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
  listeners.clear()
})

describe('usePushNotifications', () => {
  it('simulateGateArrival routes to activation\'s first step (origin gate)', () => {
    const { result } = renderHook(() => usePushNotifications())

    act(() => result.current.simulateGateArrival('activation'))

    expect(mockPush).toHaveBeenCalledWith('/trip/phase/activation/step/2-verification')
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/trip/undefined/'))
  })

  // in_transit has no driver steps left (its GPS-capture step is gone and the phase is
  // auto-completed server-side), so a destination-arrival push must land somewhere real
  // rather than composing a ".../step/undefined" URL.
  it('simulateGateArrival falls back to the active trip when the phase has no steps', () => {
    const { result } = renderHook(() => usePushNotifications())

    act(() => result.current.simulateGateArrival('in_transit'))

    expect(mockPush).toHaveBeenCalledWith('/trips/active')
  })

  // Native only: a notification the driver taps from the shade arrives as
  // pushNotificationActionPerformed, not pushNotificationReceived.
  it('routes a tapped gate-arrival notification to the phase step', async () => {
    native.value = true
    renderHook(() => usePushNotifications())
    await vi.waitFor(() => expect(listeners.has('pushNotificationActionPerformed')).toBe(true))

    act(() => listeners.get('pushNotificationActionPerformed')!({ actionId: 'tap', notification: { data: { type: 'GATE_ARRIVAL', phase_type: 'activation' } } }))

    expect(mockPush).toHaveBeenCalledWith('/trip/phase/activation/step/2-verification')
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
})
