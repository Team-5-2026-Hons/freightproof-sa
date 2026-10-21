// The Supabase client is built on first use, not at import: building it (and its startup
// getSession) used to run inside the cold-start long task of every route.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createClient, getSession, onAuthStateChange } = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient }))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  getSession.mockResolvedValue({ data: { session: { access_token: 'seeded-token', user: { id: 'driver-1' } } } })
  createClient.mockReturnValue({ auth: { getSession, onAuthStateChange } })
})

describe('lib/supabase', () => {
  it('builds nothing and asks nothing at import', async () => {
    await import('../supabase')

    expect(createClient).not.toHaveBeenCalled()
    expect(getSession).not.toHaveBeenCalled()
  })

  it('builds one client on first use and hands the same one out after', async () => {
    const { getSupabase } = await import('../supabase')

    const first = getSupabase()
    const second = getSupabase()

    expect(first).toBe(second)
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(onAuthStateChange).toHaveBeenCalledTimes(1)
  })

  it('seeds the token cache from the stored session once the client exists', async () => {
    const { getAccessToken, getSupabase } = await import('../supabase')
    expect(getAccessToken()).toBeNull()

    getSupabase()

    await vi.waitFor(() => expect(getAccessToken()).toBe('seeded-token'))
  })

  it('keeps the cache current from auth events', async () => {
    const { getAccessToken, getSupabase } = await import('../supabase')
    getSupabase()
    const onChange = onAuthStateChange.mock.calls[0][0] as (event: string, session: unknown) => void

    onChange('TOKEN_REFRESHED', { access_token: 'fresh-token', user: { id: 'driver-1' } })

    expect(getAccessToken()).toBe('fresh-token')
  })
})
