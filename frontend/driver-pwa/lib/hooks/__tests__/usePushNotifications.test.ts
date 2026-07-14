// frontend/driver-pwa/lib/hooks/__tests__/usePushNotifications.test.ts
//
// Task 2: the deep link built by this hook must match the real route shape
// (/trip/handshake/[h]/step/[slug] — no trip id segment, see lib/constants/routes.ts).
// A stale hand-rolled template previously included a trip id, which 404s under the
// static export (every dynamic segment must be statically enumerable, and a real
// trip's UUID never is).
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { usePushNotifications } from '../usePushNotifications'
import { ROUTES } from '@/lib/constants/routes'

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
  it('simulateGateArrival routes to the real handshake-step shape (no trip id segment)', () => {
    const { result } = renderHook(() => usePushNotifications())

    act(() => result.current.simulateGateArrival(1))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.handshakeStep(1, '1-approach-gate'))
    expect(mockPush).not.toHaveBeenCalledWith(expect.stringContaining('/trip/undefined/'))
  })

  it('builds the correct route for handshake 4', () => {
    const { result } = renderHook(() => usePushNotifications())

    act(() => result.current.simulateGateArrival(4))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.handshakeStep(4, '1-approach-dest'))
  })
})
