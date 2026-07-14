import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The api client reads the bearer token and refreshes sessions through the
// Supabase client. Mock that module so the tests exercise only the request /
// retry / 401-recovery logic in client.ts.
vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
  getAccessToken: vi.fn(),
}))

import { api, ApiError } from './client'
import { getAccessToken, supabase } from '@/lib/supabase/client'

const mockedGetAccessToken = vi.mocked(getAccessToken)
const mockedGetSession = vi.mocked(supabase.auth.getSession)
const mockedSignOut = vi.mocked(supabase.auth.signOut)

// Minimal Response stub covering the fields client.ts actually reads.
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  } as unknown as Response
}

// Shape of supabase.auth.getSession()'s resolved value (only access_token is read).
function sessionWith(token: string | null) {
  return { data: { session: token ? { access_token: token } : null }, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Hot path: a token is already cached, so getSession() is not hit per request.
  mockedGetAccessToken.mockReturnValue('cached-token')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api request', () => {
  it('attaches the cached bearer token and returns parsed JSON on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: '1' }))
    vi.stubGlobal('fetch', fetchMock)

    const data = await api.get<{ id: string }>('/trips')

    expect(data).toEqual({ id: '1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/trips')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer cached-token')
  })

  it('throws ApiError with the first validation message on a 422', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(422, { detail: [{ msg: 'order_number is required' }] })),
    )

    await expect(api.get('/trips')).rejects.toBeInstanceOf(ApiError)
    await expect(api.get('/trips')).rejects.toMatchObject({
      status: 422,
      message: 'order_number is required',
    })
  })
})

describe('401 recovery', () => {
  it('refreshes the session and retries once when the first call returns 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { detail: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }))
    vi.stubGlobal('fetch', fetchMock)
    mockedGetSession.mockResolvedValue(sessionWith('fresh-token') as never)

    const data = await api.get<{ ok: boolean }>('/trips')

    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const retryInit = fetchMock.mock.calls[1][1]
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer fresh-token')
    expect(mockedSignOut).not.toHaveBeenCalled()
  })

  it('signs out and throws when the refresh yields the same (dead) token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, { detail: 'expired' }))
    vi.stubGlobal('fetch', fetchMock)
    // Same token as the cache → the 401 is not a recoverable expiry.
    mockedGetSession.mockResolvedValue(sessionWith('cached-token') as never)

    await expect(api.get('/trips')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mockedSignOut).toHaveBeenCalledTimes(1)
  })
})

describe('network-layer retry', () => {
  it('retries a GET once when the connection is dropped', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, { recovered: true }))
    vi.stubGlobal('fetch', fetchMock)

    const data = await api.get<{ recovered: boolean }>('/trips')

    expect(data).toEqual({ recovered: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not retry a POST when the connection drops', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    // A dropped POST may have already mutated server state, so it must not retry.
    await expect(api.post('/trips', { order_number: 'X' })).rejects.toBeInstanceOf(TypeError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
