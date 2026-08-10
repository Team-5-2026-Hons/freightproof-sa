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

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => false },
}))

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    requestPermissions: vi.fn(),
    register: vi.fn(),
    addListener: vi.fn(),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
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
})
