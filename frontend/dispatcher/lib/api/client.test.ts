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

import { api, ApiError, cancelTrip, overridePhase } from './client'
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

describe('cancelTrip', () => {
  it('posts the note to the cancel endpoint and returns the updated trip', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'trip-1', status: 'cancelled' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await cancelTrip('trip-1', 'Cargo pulled by client')

    expect(result).toEqual({ id: 'trip-1', status: 'cancelled' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/v1/trips/trip-1/cancel')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ note: 'Cargo pulled by client' })
  })

  it('surfaces the backend detail message on a 409 (already terminal)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(409, { detail: "Trip status is 'closed'." })),
    )

    await expect(cancelTrip('trip-1', 'note')).rejects.toMatchObject({
      status: 409,
      message: "Trip status is 'closed'.",
    })
  })
})

describe('overridePhase', () => {
  it('posts the note to the phase override endpoint and returns the updated trip', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'trip-1' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await overridePhase('trip-1', 'phase-9', 'Driver phone lost')

    expect(result).toEqual({ id: 'trip-1' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/v1/trips/trip-1/phases/phase-9/override')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ note: 'Driver phone lost' })
  })

  it('surfaces the backend detail message on a 409 (phase already resolved)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(409, { detail: "phase status is 'completed': cannot Override" })),
    )

    await expect(overridePhase('trip-1', 'phase-9', 'note')).rejects.toMatchObject({
      status: 409,
      message: "phase status is 'completed': cannot Override",
    })
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
    // The client normalises the raw TypeError into ApiError(0, …) so callers only ever
    // reconcile one error shape — assert on that, not on the underlying fetch rejection.
    await expect(api.post('/trips', { order_number: 'X' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('request timeout', () => {
  // Short enough to keep the suite fast, long enough that the stall is unambiguous.
  const SHORT_TIMEOUT_MS = 60

  // A fetch that never settles on its own — it rejects only once the client aborts it,
  // and it rejects the way WebKit does: an AbortError carrying "Fetch is aborted", not
  // the TimeoutError the spec names. That exact shape is what used to slip past the
  // client's name check, and jsdom's own AbortSignal.timeout is too spec-correct to
  // reproduce it, so the reason is supplied here deliberately.
  function stallingFetch() {
    return vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Fetch is aborted', 'AbortError')),
        )
      }),
    )
  }

  // Read-only POST: retry is on, so a timeout mistaken for a dropped connection would
  // visibly cost a second window here.
  const stalledCall = () =>
    api.post('/blockchain/verify', {}, { idempotent: true, timeoutMs: SHORT_TIMEOUT_MS })

  it('reports a stalled request as a timeout, whatever the browser calls the abort', async () => {
    vi.stubGlobal('fetch', stallingFetch())

    await expect(stalledCall()).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: expect.stringContaining(`timed out after ${SHORT_TIMEOUT_MS}ms`),
    })
  })

  // The costly half of the same bug: a timeout that reads as an ordinary network failure
  // gets retried, so an idempotent call spent two full windows stalling before it spoke.
  it('does not spend a second window retrying a request that timed out', async () => {
    const fetchMock = stallingFetch()
    vi.stubGlobal('fetch', fetchMock)

    await expect(stalledCall()).rejects.toBeInstanceOf(ApiError)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  // A response whose headers arrive normally but whose BODY never settles. This is the
  // half-open socket the timeout actually exists for, and the half fetch() cannot signal:
  // it resolved back at the headers, so only the body promise is left to reject. json()
  // settles solely when the client aborts, so if the window is disarmed on the headers
  // this response hangs the caller forever.
  function stallingBodyResponse(signal: AbortSignal | undefined): Response {
    return {
      ok: true,
      status: 200,
      statusText: 'HTTP 200',
      json: () =>
        new Promise<unknown>((_resolve, reject) => {
          signal?.addEventListener('abort', () =>
            reject(new DOMException('Fetch is aborted', 'AbortError')),
          )
        }),
    } as unknown as Response
  }

  // Same short-window call as stalledCall(), so the suite never waits on the real 12s ceiling.
  const stalledBodyCall = () =>
    api.post('/blockchain/verify', {}, { idempotent: true, timeoutMs: SHORT_TIMEOUT_MS })

  it('reports a stalled response body as a timeout, not a hang', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) =>
      Promise.resolve(stallingBodyResponse(init.signal ?? undefined)),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(stalledBodyCall()).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
      message: expect.stringContaining(`timed out after ${SHORT_TIMEOUT_MS}ms`),
    })
  })

  // Rejecting the caller's promise is only half the job: the socket has to be released
  // too, or a stalled body leaks a connection for as long as the tab lives.
  it('aborts the underlying request when the body stalls', async () => {
    let captured: AbortSignal | undefined
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      captured = init.signal ?? undefined
      return Promise.resolve(stallingBodyResponse(captured))
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(stalledBodyCall()).rejects.toBeInstanceOf(ApiError)

    expect(captured?.aborted).toBe(true)
  })

  // The retry must survive: a dropped connection is not a timeout, and recovering from a
  // dead keep-alive is the reason it exists.
  it('still retries a GET whose connection drops rather than stalls', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, { recovered: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(api.get('/trips')).resolves.toEqual({ recovered: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
