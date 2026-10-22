import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import PhoneLoginPage from '../page'
import { AuthContext } from '@/lib/context/AuthContext'
import type { AuthState } from '@/lib/types/user'
import { ROUTES } from '@/lib/constants/routes'

const mockRequestOtp = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

function renderPhonePage() {
  const authValue: AuthState = {
    user: null,
    isLoading: false,
    connectionFault: false,
    retryProfile: vi.fn(),
    requestOtp: mockRequestOtp,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }

  render(
    <AuthContext.Provider value={authValue}>
      <PhoneLoginPage />
    </AuthContext.Provider>,
  )
}

function getPhoneInput() {
  return screen.getByLabelText(/phone number/i)
}

// Continue only opens the "Is this your number?" sheet; Confirm is what sends the code.
async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /continue/i }))
  })
  const confirm = screen.queryByRole('button', { name: /confirm/i })
  if (confirm) {
    await act(async () => {
      fireEvent.click(confirm)
    })
  }
}

describe('PhoneLoginPage phone number entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestOtp.mockResolvedValue(undefined)
  })

  it('defaults the country picker to South Africa (+27)', () => {
    renderPhonePage()

    expect(screen.getByRole('button', { name: /\+27/ })).toBeInTheDocument()
  })

  it('strips non-digit characters from the local number as the driver types', () => {
    renderPhonePage()
    const input = getPhoneInput()

    fireEvent.change(input, { target: { value: '0d81-046 3076' } })

    expect(input).toHaveValue('0810463076')
  })

  it('combines the default country code with a leading-zero local number and calls requestOtp', async () => {
    renderPhonePage()
    const input = getPhoneInput()

    fireEvent.change(input, { target: { value: '0810463076' } })
    await submit()

    expect(mockRequestOtp).toHaveBeenCalledWith('+27810463076')
    expect(mockPush).toHaveBeenCalledWith('/otp?phone=%2B27810463076')
  })

  it('rejects a too-short local number on submit without calling requestOtp', async () => {
    renderPhonePage()
    const input = getPhoneInput()

    fireEvent.change(input, { target: { value: '5' } })
    await submit()

    expect(mockRequestOtp).not.toHaveBeenCalled()
    expect(screen.getByText(/enter a valid phone number/i)).toBeInTheDocument()
  })

  it('lets the driver pick a different country and combines its dial code on submit', async () => {
    renderPhonePage()

    fireEvent.click(screen.getByRole('button', { name: /\+27/ }))
    fireEvent.click(screen.getByRole('option', { name: /united kingdom/i }))

    fireEvent.change(getPhoneInput(), { target: { value: '7911123456' } })
    await submit()

    expect(mockRequestOtp).toHaveBeenCalledWith('+447911123456')
  })

  it('updates the local-number placeholder to match the selected country', () => {
    renderPhonePage()

    expect(getPhoneInput()).toHaveAttribute('placeholder', '123 456 7890')

    fireEvent.click(screen.getByRole('button', { name: /\+27/ }))
    fireEvent.click(screen.getByRole('option', { name: /united kingdom/i }))

    // United Kingdom's local length (11) produces a differently-grouped, generic placeholder.
    expect(getPhoneInput()).toHaveAttribute('placeholder', '123 456 789 01')
  })

  it('filters the country list by search query', () => {
    renderPhonePage()

    fireEvent.click(screen.getByRole('button', { name: /\+27/ }))
    fireEvent.change(screen.getByPlaceholderText(/search country or code/i), {
      target: { value: 'kenya' },
    })

    expect(screen.getByRole('option', { name: /kenya/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /united kingdom/i })).not.toBeInTheDocument()
  })

  it('asks the driver to confirm their number before any code is sent', async () => {
    renderPhonePage()
    fireEvent.change(getPhoneInput(), { target: { value: '0810463076' } })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    })

    expect(screen.getByRole('heading', { name: /is this your number/i })).toBeInTheDocument()
    expect(screen.getByText('+27 81 046 3076')).toBeInTheDocument()
    expect(mockRequestOtp).not.toHaveBeenCalled()
  })

  it('sends nothing when the driver goes back from the confirm sheet', async () => {
    renderPhonePage()
    fireEvent.change(getPhoneInput(), { target: { value: '0810463076' } })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /continue/i }))
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /go back/i }))
    })

    expect(mockRequestOtp).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /confirm/i })).not.toBeInTheDocument()
  })

  it('shows the dispatcher message when the number is not registered', async () => {
    mockRequestOtp.mockRejectedValue(new Error('Signups not allowed for otp'))
    renderPhonePage()
    fireEvent.change(getPhoneInput(), { target: { value: '0810463076' } })

    await submit()

    expect(screen.getByRole('alert')).toHaveTextContent(/not registered — contact your dispatcher/i)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('returns to the welcome screen from the back button', () => {
    renderPhonePage()

    fireEvent.click(screen.getByRole('button', { name: /back to welcome/i }))

    expect(mockPush).toHaveBeenCalledWith(ROUTES.login)
  })
})
