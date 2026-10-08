/**
 * A reload must never flash the login screen.
 *
 * Session restore goes through the auth port, so it settles a few microtasks after mount
 * instead of inside the mount effect. That is only safe because `isLoading` stays true
 * until the session AND the profile have both resolved. app/(app)/layout.tsx redirects to
 * /login on exactly `!isLoading && !user`; the probe below applies that same predicate on
 * every render, so any frame in which the guard would send the driver to /login is recorded.
 */

import { act, render, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AuthChangeListener, AuthSession, OtpAuthPort } from '@shared/lib/auth/port'
import { AuthProvider, DEMO_SESSION_KEY } from '@/lib/context/AuthContext'
import type { DriverProfileSource } from '@/lib/auth/DriverProfileSource'
import { MOCK_DRIVER } from '@/lib/auth/DemoDriverProfileSource'
import { useAuth } from '@/lib/hooks/useAuth'
import type { DriverUser } from '@/lib/types/user'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: true }))
vi.mock('@/lib/hooks/useIdleTimeout', () => ({ useIdleTimeout: vi.fn() }))

type GuardView = 'loading' | 'login' | 'app'

/** What the route guard would show for this auth state. */
function viewFor(isLoading: boolean, user: DriverUser | null): GuardView {
  if (isLoading) return 'loading'
  return user ? 'app' : 'login'
}

function renderGuardProbe(provider: { port?: OtpAuthPort; profiles?: DriverProfileSource } = {}) {
  const views: GuardView[] = []
  const redirectToLogin = vi.fn()

  function Probe() {
    const { isLoading, user } = useAuth()
    // Recorded during render, so even a single transient frame is captured.
    views.push(viewFor(isLoading, user))
    useEffect(() => {
      // The layout's own redirect condition, verbatim.
      if (!isLoading && !user) redirectToLogin()
    }, [isLoading, user])
    return null
  }

  render(
    <AuthProvider {...provider}>
      <Probe />
    </AuthProvider>,
  )
  return { views, redirectToLogin }
}

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('session restore never shows the login view while it is pending', () => {
  it('demo mode, restored session: loading, then the app, and never login', async () => {
    sessionStorage.setItem(DEMO_SESSION_KEY, 'true')

    const { views, redirectToLogin } = renderGuardProbe()

    await waitFor(() => expect(views.at(-1)).toBe('app'))
    expect(views).not.toContain('login')
    expect(views[0]).toBe('loading')
    expect(redirectToLogin).not.toHaveBeenCalled()
  })

  // Control: proves the probe can see the login view at all, so the test above is not
  // passing merely because nothing is ever recorded.
  it('demo mode, no session: loading, then login', async () => {
    const { views, redirectToLogin } = renderGuardProbe()

    await waitFor(() => expect(views.at(-1)).toBe('login'))
    expect(views[0]).toBe('loading')
    expect(redirectToLogin).toHaveBeenCalledTimes(1)
  })

  it('a slow profile load keeps the guard on loading, not login', async () => {
    let finishProfile: (profile: DriverUser) => void = () => {}
    const profiles: DriverProfileSource = {
      loadProfile: () => new Promise<DriverUser | null>(resolve => { finishProfile = resolve }),
    }
    const port: OtpAuthPort = {
      getSession: async (): Promise<AuthSession | null> => ({ userId: String(MOCK_DRIVER.id) }),
      onChange: (_listener: AuthChangeListener) => () => {},
      signOut: async () => {},
      requestOtp: async () => {},
      verifyOtp: async () => {},
    }

    const { views, redirectToLogin } = renderGuardProbe({ port, profiles })
    // Session has resolved; the profile has not. Let every pending microtask run.
    await act(async () => { await Promise.resolve() })

    expect(views.at(-1)).toBe('loading')
    expect(redirectToLogin).not.toHaveBeenCalled()

    await act(async () => { finishProfile(MOCK_DRIVER) })

    expect(views.at(-1)).toBe('app')
    expect(views).not.toContain('login')
    expect(redirectToLogin).not.toHaveBeenCalled()
  })
})
