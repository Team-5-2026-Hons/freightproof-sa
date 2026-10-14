import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LoginPage from './page'
import { ROUTES } from '@/lib/constants/routes'
import { RETURN_PATH_KEY } from '@shared/lib/session/return-path'

const mockSignIn = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}))

// Same approach Sidebar.test.tsx uses for useAuth — this suite is about the redirect
// target after a successful sign-in, not the credential exchange itself.
vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    signIn: mockSignIn,
    signOut: vi.fn(),
  }),
}))

// LoginPage also imports ProfileUnavailableError directly from AuthContext (for an
// instanceof check), which otherwise pulls in the real Supabase client and throws
// without env vars configured for the test runner — see AuthContext.test.tsx for the
// same issue solved by mocking the client itself instead.
vi.mock('@/lib/context/AuthContext', () => ({
  ProfileUnavailableError: class ProfileUnavailableError extends Error {},
}))

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'dispatcher@linbroexpress.co.za' } })
  fireEvent.change(screen.getByLabelText(/password/i), { target: { value: 'correct-horse' } })
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('LoginPage return-path redirect', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignIn.mockResolvedValue(undefined)
    localStorage.clear()
  })

  it('redirects to a saved return path instead of the default landing page', async () => {
    localStorage.setItem(RETURN_PATH_KEY, '/trips/detail/9f1c8b2a')
    render(<LoginPage />)

    await act(async () => { fillAndSubmit() })

    expect(mockPush).toHaveBeenCalledWith('/trips/detail/9f1c8b2a')
  })

  it('consumes the saved return path so it cannot be reused by a later sign-in', async () => {
    localStorage.setItem(RETURN_PATH_KEY, '/trips/detail/9f1c8b2a')
    render(<LoginPage />)

    await act(async () => { fillAndSubmit() })

    expect(localStorage.getItem(RETURN_PATH_KEY)).toBeNull()
  })

  it('falls back to the default landing page when nothing was saved', async () => {
    render(<LoginPage />)

    await act(async () => { fillAndSubmit() })

    expect(mockPush).toHaveBeenCalledWith(ROUTES.home)
  })

  it('rejects an unsafe saved value and falls back to the default landing page', async () => {
    // Re-validated on the way out — a stored value is not trusted just because it once
    // passed validation on the way in.
    localStorage.setItem(RETURN_PATH_KEY, '//evil.com')
    render(<LoginPage />)

    await act(async () => { fillAndSubmit() })

    expect(mockPush).toHaveBeenCalledWith(ROUTES.home)
  })
})
