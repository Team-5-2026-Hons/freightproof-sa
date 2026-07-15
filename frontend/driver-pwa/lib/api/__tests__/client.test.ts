// frontend/driver-pwa/lib/api/__tests__/client.test.ts
//
// Covers the hardening in lib/api/client.ts: a wedged token refresh or a stalled
// socket must never hang a handshake submit forever with no feedback to the driver.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockGetAccessToken = vi.fn()

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
  getAccessToken: () => mockGetAccessToken(),
}))

describe('api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Default: cache is warm, so getSession is never the hot path unless a test
    // explicitly simulates a cold start by returning null.
    mockGetAccessToken.mockReturnValue('cached-token')
  })

  it('uses the cached token without calling getSession', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'trip-1' }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { api } = await import('../client')
    const result = await api.get('/api/v1/trips/me/active')

    expect(result).toEqual({ id: 'trip-1' })
    expect(mockGetSession).not.toHaveBeenCalled()
    const [, init] = fetchSpy.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer cached-token')

    vi.unstubAllGlobals()
  })

  it('surfaces a fetch timeout as ApiError with status 0', async () => {
    // AbortSignal.timeout() rejects fetch with this exact DOMException once the request
    // ceiling is hit — mimic it directly rather than waiting out a real 12s timer.
    const fetchSpy = vi.fn().mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))
    vi.stubGlobal('fetch', fetchSpy)

    const { api, ApiError } = await import('../client')

    await expect(api.get('/api/v1/trips/me/active')).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
    })
    await expect(api.get('/api/v1/trips/me/active')).rejects.toBeInstanceOf(ApiError)

    vi.unstubAllGlobals()
  })

  it('parses a non-ok JSON response into an ApiError with the backend detail message', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      json: () => Promise.resolve({ detail: 'Trip is not in the expected state' }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { api, ApiError } = await import('../client')

    await expect(
      api.post('/api/v1/trips/trip-1/handshakes/h1/complete', { driver_phone_lat: 1 }),
    ).rejects.toThrow('Trip is not in the expected state')
    await expect(
      api.post('/api/v1/trips/trip-1/handshakes/h1/complete', { driver_phone_lat: 1 }),
    ).rejects.toBeInstanceOf(ApiError)

    vi.unstubAllGlobals()
  })

  it('falls back to a bounded getSession() when the token cache is cold', async () => {
    mockGetAccessToken.mockReturnValue(null)
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'fresh-token' } } })
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'trip-1' }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { api } = await import('../client')
    await api.get('/api/v1/trips/me/active')

    expect(mockGetSession).toHaveBeenCalledTimes(1)
    const [, init] = fetchSpy.mock.calls[0]
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer fresh-token')

    vi.unstubAllGlobals()
  })

  it('postForm sends the FormData body without setting Content-Type', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ id: 'artifact-1' }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { api } = await import('../client')
    const form = new FormData()
    form.append('file', new Blob(['x']), 'x.jpg')
    await api.postForm('/api/v1/artifacts', form)

    const [, init] = fetchSpy.mock.calls[0]
    expect(init.body).toBe(form)
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined()

    vi.unstubAllGlobals()
  })
})
