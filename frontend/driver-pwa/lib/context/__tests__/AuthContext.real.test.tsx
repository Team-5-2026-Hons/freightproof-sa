import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider } from '@/lib/context/AuthContext'
import { useAuth } from '@/lib/hooks/useAuth'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))

const mockSignInWithOtp = vi.fn()
const mockVerifyOtp = vi.fn()
const mockGetSession = vi.fn()
const mockOnAuthStateChange = vi.fn()
const mockSignOut = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithOtp: (...args: unknown[]) => mockSignInWithOtp(...args),
      verifyOtp: (...args: unknown[]) => mockVerifyOtp(...args),
      getSession: (...args: unknown[]) => mockGetSession(...args),
      onAuthStateChange: (...args: unknown[]) => mockOnAuthStateChange(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  },
}))

const mockApiGet = vi.fn()
vi.mock('@/lib/api/client', () => ({
  api: { get: (...args: unknown[]) => mockApiGet(...args) },
}))

describe('AuthContext (real Supabase mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSession.mockResolvedValue({ data: { session: null } })
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } })
  })

  it('requestOtp calls signInWithOtp over WhatsApp with shouldCreateUser false', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: null })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await act(async () => {
      await result.current.requestOtp('+27821234567')
    })

    expect(mockSignInWithOtp).toHaveBeenCalledWith({
      phone: '+27821234567',
      options: { channel: 'whatsapp', shouldCreateUser: false },
    })
  })

  it('requestOtp throws when Supabase rejects an unregistered phone', async () => {
    mockSignInWithOtp.mockResolvedValue({ error: new Error('Signups not allowed for otp') })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await expect(
      act(async () => {
        await result.current.requestOtp('+27800000000')
      }),
    ).rejects.toThrow('Signups not allowed for otp')
  })

  it('signIn verifies the OTP and loads the driver profile', async () => {
    mockVerifyOtp.mockResolvedValue({ error: null })
    mockApiGet.mockResolvedValue({ id: 'driver-1', full_name: 'Test Driver' })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await act(async () => {
      await result.current.signIn({ phone_number: '+27821234567', otp: '123456' })
    })

    expect(mockVerifyOtp).toHaveBeenCalledWith({
      phone: '+27821234567',
      token: '123456',
      type: 'sms',
    })
    expect(mockApiGet).toHaveBeenCalledWith('/api/v1/drivers/me')
    expect(result.current.user).toEqual({ id: 'driver-1', full_name: 'Test Driver' })
  })

  it('signIn throws and does not set a user when verifyOtp fails', async () => {
    mockVerifyOtp.mockResolvedValue({ error: new Error('Token has expired or is invalid') })
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await expect(
      act(async () => {
        await result.current.signIn({ phone_number: '+27821234567', otp: '000000' })
      }),
    ).rejects.toThrow('Token has expired or is invalid')

    expect(result.current.user).toBeNull()
  })
})
