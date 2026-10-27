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

vi.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({
    user: null,
    isLoading: false,
    signIn: mockSignIn,
    signOut: vi.fn(),
  }),
}))

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

  it('ignores a saved developer-tools path and lands on the default page', async () => {
    localStorage.setItem(RETURN_PATH_KEY, '/dev/design')
    render(<LoginPage />)

    await act(async () => { fillAndSubmit() })

    expect(mockPush).toHaveBeenCalledWith(ROUTES.home)
    expect(localStorage.getItem(RETURN_PATH_KEY)).toBeNull()
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
    localStorage.setItem(RETURN_PATH_KEY, '//evil.com')
    render(<LoginPage />)

    await act(async () => { fillAndSubmit() })

    expect(mockPush).toHaveBeenCalledWith(ROUTES.home)
  })

  it('lands on the page chosen in Settings when there is no saved return path', async () => {
    localStorage.setItem('fp.preferences.v1', JSON.stringify({ landingPage: 'exceptions', rowsPerPage: 25 }))
    render(<LoginPage />)

    await act(async () => { fillAndSubmit() })

    expect(mockPush).toHaveBeenCalledWith(ROUTES.exceptions)
  })

  it('lets a saved return path win over the chosen landing page', async () => {
    localStorage.setItem('fp.preferences.v1', JSON.stringify({ landingPage: 'exceptions', rowsPerPage: 25 }))
    localStorage.setItem(RETURN_PATH_KEY, '/trips/detail/9f1c8b2a')
    render(<LoginPage />)

    await act(async () => { fillAndSubmit() })

    expect(mockPush).toHaveBeenCalledWith('/trips/detail/9f1c8b2a')
  })
})
