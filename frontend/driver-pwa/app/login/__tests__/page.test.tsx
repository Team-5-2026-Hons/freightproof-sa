import { render, screen, fireEvent, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import LoginPage from '../page'
import { AuthContext } from '@/lib/context/AuthContext'
import type { AuthState } from '@/lib/types/user'

const mockRequestOtp = vi.fn()
const mockPush = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn() }),
}))

function renderLoginPage() {
  const authValue: AuthState = {
    user: null,
    isLoading: false,
    requestOtp: mockRequestOtp,
    signIn: vi.fn(),
    signOut: vi.fn(),
  }

  render(
    <AuthContext.Provider value={authValue}>
      <LoginPage />
    </AuthContext.Provider>,
  )
}

function getPhoneInput() {
  return screen.getByLabelText(/phone number/i)
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /send otp/i }))
  })
}

describe('LoginPage phone number entry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestOtp.mockResolvedValue(undefined)
  })

  it('defaults the country picker to South Africa (+27)', () => {
    renderLoginPage()

    expect(screen.getByRole('button', { name: /\+27/ })).toBeInTheDocument()
  })

  it('strips non-digit characters from the local number as the driver types', () => {
    renderLoginPage()
    const input = getPhoneInput()

    fireEvent.change(input, { target: { value: '0d81-046 3076' } })

    expect(input).toHaveValue('0810463076')
  })

  it('combines the default country code with a leading-zero local number and calls requestOtp', async () => {
    renderLoginPage()
    const input = getPhoneInput()

    fireEvent.change(input, { target: { value: '0810463076' } })
    await submit()

    expect(mockRequestOtp).toHaveBeenCalledWith('+27810463076')
    expect(mockPush).toHaveBeenCalledWith('/otp?phone=%2B27810463076')
  })

  it('rejects a too-short local number on submit without calling requestOtp', async () => {
    renderLoginPage()
    const input = getPhoneInput()

    fireEvent.change(input, { target: { value: '5' } })
    await submit()

    expect(mockRequestOtp).not.toHaveBeenCalled()
    expect(screen.getByText(/enter a valid phone number/i)).toBeInTheDocument()
  })

  it('lets the driver pick a different country and combines its dial code on submit', async () => {
    renderLoginPage()

    fireEvent.click(screen.getByRole('button', { name: /\+27/ }))
    fireEvent.click(screen.getByRole('option', { name: /united kingdom/i }))

    fireEvent.change(getPhoneInput(), { target: { value: '7911123456' } })
    await submit()

    expect(mockRequestOtp).toHaveBeenCalledWith('+447911123456')
  })

  it('updates the local-number placeholder to match the selected country', () => {
    renderLoginPage()

    expect(getPhoneInput()).toHaveAttribute('placeholder', '123 456 7890')

    fireEvent.click(screen.getByRole('button', { name: /\+27/ }))
    fireEvent.click(screen.getByRole('option', { name: /united kingdom/i }))

    // United Kingdom's local length (11) produces a differently-grouped, generic placeholder.
    expect(getPhoneInput()).toHaveAttribute('placeholder', '123 456 789 01')
  })

  it('filters the country list by search query', () => {
    renderLoginPage()

    fireEvent.click(screen.getByRole('button', { name: /\+27/ }))
    fireEvent.change(screen.getByPlaceholderText(/search country or code/i), {
      target: { value: 'kenya' },
    })

    expect(screen.getByRole('option', { name: /kenya/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /united kingdom/i })).not.toBeInTheDocument()
  })
})
