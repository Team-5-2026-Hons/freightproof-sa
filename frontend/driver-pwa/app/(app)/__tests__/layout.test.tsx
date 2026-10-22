// The app-level native listeners (push, hardware back, restored camera result) are mounted
// by the guarded layout: once, and only for a signed-in driver.
import { render } from '@testing-library/react'
import { createContext } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { usePushNotifications, bridgeMounts, auth, passthrough } = vi.hoisted(() => ({
  passthrough: ({ children }: { children: unknown }) => children,
  usePushNotifications: vi.fn(),
  bridgeMounts: vi.fn(),
  auth: { value: { isLoading: false, user: { id: 'driver-1' } } as { isLoading: boolean, user: { id: string } | null } },
}))

vi.mock('@/lib/context/AuthContext', () => ({
  AuthContext: createContext<unknown>(null),
  SUPPRESS_RETURN_SAVE_KEY: 'fp:suppress-return-save',
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
}))
// TripContext itself is needed, not just the provider: the layout mounts
// TripCompleteOverlay, which reads the completed-trip snapshot off this context. A
// null-valued context renders the overlay as nothing, which is what this test wants.
vi.mock('@/lib/context/TripContext', () => ({
  TripProvider: passthrough,
  TripContext: createContext<unknown>(null),
}))
vi.mock('@/lib/context/LocationContext', () => ({ LocationProvider: passthrough }))
vi.mock('@/lib/context/DriverSubstitutionContext', () => ({ DriverSubstitutionProvider: passthrough }))
vi.mock('@/components/layout/AppShell', () => ({ AppShell: passthrough }))
vi.mock('@/lib/hooks/usePushNotifications', () => ({ usePushNotifications }))
vi.mock('@/components/layout/CapacitorBridge', () => ({
  CapacitorBridge: () => {
    bridgeMounts()
    return null
  },
}))

import { AuthContext } from '@/lib/context/AuthContext'
import AppLayout from '../layout'

function renderLayout() {
  return render(
    <AuthContext.Provider value={auth.value as never}>
      <AppLayout><p>screen</p></AppLayout>
    </AuthContext.Provider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.value = { isLoading: false, user: { id: 'driver-1' } }
})

describe('AppLayout native listeners', () => {
  it('mounts push and the Capacitor bridge once for a signed-in driver', () => {
    renderLayout()

    expect(usePushNotifications).toHaveBeenCalledTimes(1)
    expect(bridgeMounts).toHaveBeenCalledTimes(1)
  })

  it('mounts neither before the driver is signed in', () => {
    auth.value = { isLoading: false, user: null }

    renderLayout()

    expect(usePushNotifications).not.toHaveBeenCalled()
    expect(bridgeMounts).not.toHaveBeenCalled()
  })
})
