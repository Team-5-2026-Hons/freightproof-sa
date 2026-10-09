/** Which adapters the app wires up when a provider is not handed its own. */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} } }))
vi.mock('@/lib/api/client', () => ({ api: { get: vi.fn() }, ApiError: class ApiError extends Error {} }))

describe('default adapters', () => {
  it('demo mode wires the demo adapters, and hands out the same instance every time', async () => {
    vi.resetModules()
    vi.doMock('@/lib/constants/env', () => ({ IS_DEMO_MODE: true }))
    const { defaultOtpAuth, defaultProfileSource } = await import('../defaults')
    const { DemoOtpAuth } = await import('../DemoOtpAuth')
    const { DemoDriverProfileSource } = await import('../DemoDriverProfileSource')

    expect(defaultOtpAuth()).toBeInstanceOf(DemoOtpAuth)
    expect(defaultProfileSource()).toBeInstanceOf(DemoDriverProfileSource)
    expect(defaultOtpAuth()).toBe(defaultOtpAuth())
  })

  it('real mode wires Supabase and the API', async () => {
    vi.resetModules()
    vi.doMock('@/lib/constants/env', () => ({ IS_DEMO_MODE: false }))
    const { defaultOtpAuth, defaultProfileSource } = await import('../defaults')
    const { SupabaseOtpAuth } = await import('../SupabaseOtpAuth')
    const { ApiDriverProfileSource } = await import('../ApiDriverProfileSource')

    expect(defaultOtpAuth()).toBeInstanceOf(SupabaseOtpAuth)
    expect(defaultProfileSource()).toBeInstanceOf(ApiDriverProfileSource)
  })
})
