import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import OtpPage from '../page'
import { AuthContext } from '@/lib/context/AuthContext'
import type { AuthState } from '@/lib/types/user'
import { ROUTES } from '@/lib/constants/routes'

const mockSignIn = vi.fn()
const mockRequestOtp = vi.fn()
const mockPush = vi.fn()
const mockReplace = vi.fn()

const PHONE = '+27821234567'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  // The page only calls .get('phone'); a plain URLSearchParams satisfies that.
  useSearchParams: () => new URLSearchParams(`phone=${encodeURIComponent('+27821234567')}`),
}))

function renderOtpPage() {
  const authValue: AuthState = {
    user: null,
    isLoading: false,
    requestOtp: mockRequestOtp,
    signIn: mockSignIn,
    signOut: vi.fn(),
  }

  render(
    <AuthContext.Provider value={authValue}>
      <OtpPage />
    </AuthContext.Provider>,
  )
}

function getOtpInput() {
  return screen.getByLabelText(/6-digit code/i)
}

describe('OtpPage resend cooldown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestOtp.mockResolvedValue(undefined)
    // Cooldown behaviour is driven by wall-clock timers — control them.
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('disables resend immediately on load because the login page just sent an OTP', () => {
    renderOtpPage()

    const resend = screen.getByRole('button', { name: /resend in 30s/i })

    expect(resend).toBeDisabled()
  })

  it('counts the cooldown down visibly', () => {
    renderOtpPage()

    act(() => {
      vi.advanceTimersByTime(6_000)
    })

    expect(screen.getByRole('button', { name: /resend in 24s/i })).toBeDisabled()
  })

  it('enables resend after the 30-second cooldown elapses', () => {
    renderOtpPage()

    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    expect(screen.getByRole('button', { name: /resend code/i })).toBeEnabled()
  })

  it('resend calls requestOtp with the phone and restarts the cooldown', async () => {
    renderOtpPage()
    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /resend code/i }))
    })

    expect(mockRequestOtp).toHaveBeenCalledWith(PHONE)
    expect(screen.getByRole('button', { name: /resend in 30s/i })).toBeDisabled()
  })

  it('does not restart the cooldown when the resend request fails', async () => {
    mockRequestOtp.mockRejectedValue(new Error('WhatsApp sandbox unavailable'))
    renderOtpPage()
    act(() => {
      vi.advanceTimersByTime(30_000)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /resend code/i }))
    })

    expect(screen.getByText(/whatsapp sandbox unavailable/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /resend code/i })).toBeEnabled()
  })
})

describe('OtpPage auto-submit and navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignIn.mockResolvedValue(undefined)
    mockRequestOtp.mockResolvedValue(undefined)
  })

  it('auto-submits when the 6th digit lands, without pressing Verify', async () => {
    renderOtpPage()

    await act(async () => {
      fireEvent.change(getOtpInput(), { target: { value: '123456' } })
    })

    expect(mockSignIn).toHaveBeenCalledWith({ phone_number: PHONE, otp: '123456' })
    expect(mockReplace).toHaveBeenCalledWith(ROUTES.trips)
  })

  it('does not auto-submit again while a verification is already in flight', async () => {
    let resolveSignIn: (() => void) | undefined
    mockSignIn.mockImplementation(
      () => new Promise<void>((resolve) => { resolveSignIn = resolve }),
    )
    renderOtpPage()
    const input = getOtpInput()

    await act(async () => {
      fireEvent.change(input, { target: { value: '123456' } })
    })
    // A second 6-digit change while loading must be ignored by the guard.
    await act(async () => {
      fireEvent.change(input, { target: { value: '654321' } })
    })

    expect(mockSignIn).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveSignIn?.()
    })
  })

  it('does not auto-submit with fewer than 6 digits', async () => {
    renderOtpPage()

    await act(async () => {
      fireEvent.change(getOtpInput(), { target: { value: '12345' } })
    })

    expect(mockSignIn).not.toHaveBeenCalled()
  })

  it('offers a way back to login for a mistyped phone number', () => {
    renderOtpPage()

    fireEvent.click(screen.getByRole('button', { name: /wrong number\? go back/i }))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.login)
  })
})
