// frontend/driver-pwa/lib/api/__tests__/client.test.ts
//
// Covers the hardening in lib/api/client.ts: a wedged token refresh or a stalled
// socket must never hang a handshake submit forever with no feedback to the driver.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const mockGetSession = vi.fn()
const mockGetAccessToken = vi.fn()
const mockRefreshSession = vi.fn()

const mockSignOut = vi.fn()

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
      signOut: (...args: unknown[]) => mockSignOut(...args),
    },
  }),
  getAccessToken: () => mockGetAccessToken(),
}))

describe('api client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('carries the Retry-After delay on a rate-limit error', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      headers: new Headers({ 'Retry-After': '7' }),
      json: () => Promise.resolve({ detail: 'Too many requests' }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { api } = await import('../client')

    await expect(api.post('/api/v1/trips/trip-1/exceptions', {})).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 7_000,
    })

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

  it('on a 401, force-refreshes the session and retries once with the new token', async () => {
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: 'refreshed-token' } },
      error: null,
    })
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized', json: () => Promise.resolve({ detail: 'Token expired' }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ id: 'trip-1' }) })
    vi.stubGlobal('fetch', fetchSpy)

    const { api } = await import('../client')
    const result = await api.get('/api/v1/trips/me/active')

    expect(result).toEqual({ id: 'trip-1' })
    expect(mockRefreshSession).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const [, retryInit] = fetchSpy.mock.calls[1]
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer refreshed-token')

    vi.unstubAllGlobals()
  })

  it('on a 401, throws the ApiError and never retries twice when refreshSession fails', async () => {
    mockRefreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'refresh token expired' },
    })
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ detail: 'Token expired' }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { api, ApiError } = await import('../client')

    await expect(api.get('/api/v1/trips/me/active')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(mockRefreshSession).toHaveBeenCalledTimes(1)
    await expect(api.get('/api/v1/trips/me/active')).rejects.toBeInstanceOf(ApiError)

    vi.unstubAllGlobals()
  })

  it('on a 401, throws the ApiError and never retries twice when the retry itself 401s', async () => {
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: 'refreshed-token' } },
      error: null,
    })
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ detail: 'Still unauthorized' }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { api, ApiError } = await import('../client')

    await expect(api.get('/api/v1/trips/me/active')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(mockRefreshSession).toHaveBeenCalledTimes(1)
    await expect(api.get('/api/v1/trips/me/active')).rejects.toBeInstanceOf(ApiError)

    vi.unstubAllGlobals()
  })
})

describe('api client — superseded device', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAccessToken.mockReturnValue('cached-token')
    mockSignOut.mockResolvedValue({ error: null })
    window.sessionStorage.clear()
  })

  it('signs the driver out instead of refreshing when the backend says another device took over', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      json: () => Promise.resolve({ detail: 'Signed in on another device.' }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { api } = await import('../client')
    const { SIGNED_OUT_REASON_KEY } = await import('@/lib/session/signed-out-reason')

    await expect(api.get('/api/v1/trips/me/active')).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      message: 'Signed in on another device.',
    })
    expect(mockSignOut).toHaveBeenCalled()
    expect(mockRefreshSession).not.toHaveBeenCalled()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(window.sessionStorage.getItem(SIGNED_OUT_REASON_KEY)).toBe('Signed in on another device.')

    vi.unstubAllGlobals()
  })

  it('still refreshes and retries an ordinary expired-token 401', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({
        ok: false, status: 401, statusText: 'Unauthorized',
        json: () => Promise.resolve({ detail: 'Token has expired.' }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ id: 'trip-1' }) })
    vi.stubGlobal('fetch', fetchSpy)
    mockRefreshSession.mockResolvedValue({ data: { session: { access_token: 'fresh' } }, error: null })

    const { api } = await import('../client')
    const result = await api.get('/api/v1/trips/me/active')

    expect(result).toEqual({ id: 'trip-1' })
    expect(mockSignOut).not.toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  describe('coded error details', () => {
    function stubErrorResponse(status: number, detail: unknown): void {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status,
        statusText: 'Conflict',
        json: () => Promise.resolve({ detail }),
      }))
    }

    it('test_coded_detail_preserves_code_and_optional_fields', async () => {
      stubErrorResponse(409, {
        code: 'SUBSTITUTION_VERSION_CHANGED',
        message: 'The arrangement changed.',
        request_id: 'request-1',
        current_version: 3,
        evidence_id: null,
      })
      const { api } = await import('../client')

      const err = await api.post('/api/v1/x').catch((e: unknown) => e)

      expect(err).toMatchObject({
        status: 409,
        message: 'The arrangement changed.',
        code: 'SUBSTITUTION_VERSION_CHANGED',
        detail: { code: 'SUBSTITUTION_VERSION_CHANGED', requestId: 'request-1', currentVersion: 3, evidenceId: null },
      })
      vi.unstubAllGlobals()
    })

    it('test_unknown_code_still_reaches_the_caller', async () => {
      stubErrorResponse(409, { code: 'A_CODE_THIS_BUILD_DOES_NOT_KNOW', message: 'New conflict.' })
      const { api } = await import('../client')

      const err = await api.get('/api/v1/x').catch((e: unknown) => e)

      expect(err).toMatchObject({ code: 'A_CODE_THIS_BUILD_DOES_NOT_KNOW' })
      vi.unstubAllGlobals()
    })

    it('test_legacy_string_detail_has_no_code', async () => {
      stubErrorResponse(409, 'Phase already completed')
      const { api } = await import('../client')

      const err = await api.get('/api/v1/x').catch((e: unknown) => e)

      expect(err).toMatchObject({ status: 409, message: 'Phase already completed' })
      expect((err as { code?: string }).code).toBeUndefined()
      vi.unstubAllGlobals()
    })

    it('test_object_detail_without_code_keeps_its_message', async () => {
      stubErrorResponse(409, { message: 'Something conflicted.' })
      const { api } = await import('../client')

      const err = await api.get('/api/v1/x').catch((e: unknown) => e)

      expect(err).toMatchObject({ message: 'Something conflicted.' })
      expect((err as { code?: string }).code).toBeUndefined()
      vi.unstubAllGlobals()
    })

    it('test_422_field_errors_still_use_the_first_message', async () => {
      stubErrorResponse(422, [{ msg: 'expected_version must be at least 1' }])
      const { api } = await import('../client')

      const err = await api.post('/api/v1/x').catch((e: unknown) => e)

      expect(err).toMatchObject({ status: 422, message: 'expected_version must be at least 1' })
      vi.unstubAllGlobals()
    })
  })
})

describe('account generation during auth awaits', () => {
  beforeEach(() => vi.clearAllMocks())
  it.each(['cold', 'refresh'])('stops_after_account_generation_changes (%s)', async (stage) => {
    const context = await import('@/lib/session/custody-context')
    context.__resetCustodyContextForTests()
    context.bindActorLease('driver-a', context.invalidateActorLease())
    let release!: (value: { data: { session: { access_token: string } }; error: null }) => void
    const paused = new Promise<{ data: { session: { access_token: string } }; error: null }>((resolve) => { release = resolve })
    mockGetAccessToken.mockReturnValue(stage === 'cold' ? null : 'old-token')
    mockGetSession.mockReturnValue(paused)
    mockRefreshSession.mockReturnValue(paused)
    const fetchSpy = vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: 'expired' }) })
    vi.stubGlobal('fetch', fetchSpy)
    const { api } = await import('../client')
    const result = api.post('/capture', { key: 'same-original-key' }).catch((error: unknown) => error)
    await vi.waitFor(() => expect(stage === 'cold' ? mockGetSession : mockRefreshSession).toHaveBeenCalled())
    context.bindActorLease('driver-b', context.invalidateActorLease())
    context.bindActorLease('driver-a', context.invalidateActorLease())
    release({ data: { session: { access_token: 'new-account-token' } }, error: null })
    await result
    expect(fetchSpy).toHaveBeenCalledTimes(stage === 'cold' ? 0 : 1)
    vi.unstubAllGlobals()
    context.__resetCustodyContextForTests()
  })
})

describe('account generation while receiving a response', () => {
  afterEach(() => vi.unstubAllGlobals())

  it.each(['headers', 'body', 'no-content'] as const)('rejects an old account response during %s', async stage => {
    const context = await import('@/lib/session/custody-context')
    context.bindActorLease('driver-a', context.invalidateActorLease())
    mockGetAccessToken.mockReturnValue('token-a')
    let release!: () => void
    const paused = new Promise<void>(resolve => { release = resolve })
    const response = {
      ok: true, status: stage === 'no-content' ? 204 : 200,
      json: vi.fn(async () => { if (stage === 'body') await paused; return { privateTripOf: 'driver-a' } }),
    }
    const fetchSpy = vi.fn(async () => { if (stage !== 'body') await paused; return response })
    vi.stubGlobal('fetch', fetchSpy)
    const { api } = await import('../client')
    const result = api.get('/api/v1/trips/me/active').catch((error: unknown) => error)
    await vi.waitFor(() => expect(stage === 'body' ? response.json : fetchSpy).toHaveBeenCalled())

    context.bindActorLease('driver-b', context.invalidateActorLease())
    context.bindActorLease('driver-a', context.invalidateActorLease())
    release()

    expect(await result).toMatchObject({ status: 0, message: expect.stringContaining('Account changed') })
  })
})
