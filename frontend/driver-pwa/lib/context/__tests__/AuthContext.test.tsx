import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { AuthProvider } from '@/lib/context/AuthContext'
import { useAuth } from '@/lib/hooks/useAuth'

vi.mock('@/lib/constants/env', () => ({ IS_DEMO_MODE: true }))

describe('AuthContext (demo mode)', () => {
  it('signIn sets the mock driver and signOut clears it', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await act(async () => {
      await result.current.signIn({ phone_number: '+27821234567', otp: '123456' })
    })
    expect(result.current.user).not.toBeNull()

    await act(async () => {
      await result.current.signOut()
    })
    expect(result.current.user).toBeNull()
  })

  it('requestOtp resolves without throwing', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider })

    await expect(
      act(async () => {
        await result.current.requestOtp('+27821234567')
      }),
    ).resolves.toBeUndefined()
  })
})
