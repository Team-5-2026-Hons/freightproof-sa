import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import WelcomePage from '../page'
import { ROUTES } from '@/lib/constants/routes'
import { rememberSignedOutReason } from '@/lib/session/signed-out-reason'

const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

describe('WelcomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.sessionStorage.clear()
  })

  it('leads with the FreightProof lockup as the page heading', () => {
    render(<WelcomePage />)

    expect(screen.getByRole('heading', { level: 1, name: 'FreightProof' })).toBeInTheDocument()
  })

  it('opens phone entry from Log In', () => {
    render(<WelcomePage />)

    fireEvent.click(screen.getByRole('button', { name: 'Log In' }))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.loginPhone)
  })

  it('offers no self sign-up and says where an account comes from instead', () => {
    render(<WelcomePage />)

    expect(screen.queryByRole('button', { name: /create account|sign up/i })).not.toBeInTheDocument()
    expect(screen.getByText(/your dispatcher sets up your account/i)).toBeInTheDocument()
  })

  it('renders always-dark, independent of the driver theme setting', () => {
    const { container } = render(<WelcomePage />)

    expect(container.firstElementChild).toHaveClass('dark')
  })

  it('explains a forced sign-out once, then stops showing it', () => {
    rememberSignedOutReason('Signed in on another device.')

    const first = render(<WelcomePage />)
    expect(screen.getByText('Signed in on another device.')).toBeInTheDocument()
    first.unmount()

    render(<WelcomePage />)
    expect(screen.queryByText('Signed in on another device.')).not.toBeInTheDocument()
  })

  it('shows no sign-out notice when the driver arrived normally', () => {
    render(<WelcomePage />)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
