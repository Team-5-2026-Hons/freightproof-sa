import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    },
  },
  getAccessToken: vi.fn(),
}))

import {
  api, ApiError, cancelTrip, overridePhase, createTripFromPPManifest,
  findLiveTripForManifest, previewPPManifest,
} from './client'
import { getAccessToken, supabase } from '@/lib/supabase/client'

const mockedGetAccessToken = vi.mocked(getAccessToken)
const mockedGetSession = vi.mocked(supabase.auth.getSession)
const mockedSignOut = vi.mocked(supabase.auth.signOut)

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  } as unknown as Response
}

function sessionWith(token: string | null) {
  return { data: { session: token ? { access_token: token } : null }, error: null }
}

beforeEach(() => {
  vi.clearAllMocks()
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
      vi.fn().mockResolvedValue(jsonResponse(422, { detail: [{ msg: 'driver_id is required' }] })),
    )

    await expect(api.get('/trips')).rejects.toBeInstanceOf(ApiError)
    await expect(api.get('/trips')).rejects.toMatchObject({
      status: 422,
      message: 'driver_id is required',
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

    await expect(api.post('/trips', { driver_id: 'X' })).rejects.toMatchObject({
      name: 'ApiError',
      status: 0,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('structured error detail (FP-281)', () => {
  it('surfaces the message of an object detail and keeps the detail itself', async () => {
    const detail = {
      code: 'MANIFEST_ALREADY_ON_TRIP',
      message: 'This PP manifest is already on trip FP-1. Cancel that trip before creating a new one.',
      trip_id: 'trip-1',
      trip_reference: 'FP-1',
    }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { detail })))

    await expect(api.post('/api/v1/trips/from-pp-manifest', {})).rejects.toMatchObject({
      status: 409,
      message: detail.message,
      detail,
    })
  })

  it('keeps a plain string detail as the message', async () => {
    const detail = "Waybill 'WAY001' is already assigned to another trip."
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, { detail })))

    await expect(api.get('/x')).rejects.toMatchObject({ status: 409, message: detail, detail })
  })

  it('falls back to the status text when the detail carries no message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(422, { detail: { code: 'X' } })))

    await expect(api.get('/x')).rejects.toMatchObject({ status: 422, message: 'HTTP 422' })
  })
})

describe('manifest trip helpers', () => {
  const key = { issuer_account: 'MOCK01', origin_hub: 'CPT', number: 81, display: 'The Courier Guy · CPT 81' }

  it('previewPPManifest asks for the typed number', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { can_create: true }))
    vi.stubGlobal('fetch', fetchMock)

    await previewPPManifest(81)

    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8000/api/v1/trips/pp-manifest-preview?manifest_number=81')
  })

  it('createTripFromPPManifest posts the payload to the manifest endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { id: 'trip-1' }))
    vi.stubGlobal('fetch', fetchMock)
    const payload = {
      manifest_number: 81, expected_snapshot_sha256: 'a'.repeat(64), driver_id: 'd', horse_id: 'h',
      trailer_ids: [], planned_departure_at: null, planned_arrival_at: null,
      origin_precinct_id: null, destination_precinct_id: null,
    }

    await createTripFromPPManifest(payload)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8000/api/v1/trips/from-pp-manifest')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual(payload)
  })

  it('findLiveTripForManifest ignores cancelled trips and other issuers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [
      { id: 'cancelled', status: 'cancelled', pp_manifest: key },
      { id: 'other-issuer', status: 'created', pp_manifest: { ...key, issuer_account: 'RTT001' } },
      { id: 'live', status: 'created', pp_manifest: key },
    ])))

    await expect(findLiveTripForManifest(key)).resolves.toEqual({ id: 'live' })
  })

  it('findLiveTripForManifest returns null when no live trip carries the manifest', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, [
      { id: 'cancelled', status: 'cancelled', pp_manifest: key },
    ])))

    await expect(findLiveTripForManifest(key)).resolves.toBeNull()
  })

  it('findLiveTripForManifest preserves lookup failures as ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { detail: 'lookup failed' })))

    await expect(findLiveTripForManifest(key)).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: 'lookup failed',
    })
  })
})

describe('request timeout', () => {
  const SHORT_TIMEOUT_MS = 60

  function stallingFetch() {
    return vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(new DOMException('Fetch is aborted', 'AbortError')),
        )
      }),
    )
  }

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

  it('does not spend a second window retrying a request that timed out', async () => {
    const fetchMock = stallingFetch()
    vi.stubGlobal('fetch', fetchMock)

    await expect(stalledCall()).rejects.toBeInstanceOf(ApiError)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

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
