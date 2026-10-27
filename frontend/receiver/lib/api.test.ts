// frontend/receiver/lib/api.test.ts
//
// resolveVerification carries a stranger's name and ID number. A URL is logged by the
// server, proxies and the hosting platform; a request body is not — so where those two
// values travel is the thing under test, not an implementation detail.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  confirmHandover,
  fetchScan,
  HandoverError,
  isTokenRejected,
  isTransientFailure,
  recordConsent,
  recordConsentDecline,
  resolveVerification,
  type ConfirmPayload,
} from './api'

const VERIFICATION_STATE = { status: 'verified', tier: 'document_and_face' }

describe('resolveVerification', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(VERIFICATION_STATE), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  it('puts no query string on the request URL', async () => {
    await resolveVerification('tok123', 'Thandi Nkosi', '9202204720082')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(url).search).toBe('')
    expect(url).not.toContain('Nkosi')
    expect(url).not.toContain('9202204720082')
  })

  it('sends the typed identity as a JSON body', async () => {
    await resolveVerification('tok123', 'Thandi Nkosi', '9202204720082')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({
      receiver_name: 'Thandi Nkosi',
      receiver_id_number: '9202204720082',
    })
  })

  it('still includes credentials so the binding cookie is presented', async () => {
    await resolveVerification('tok123', 'a', 'b')

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.credentials).toBe('include')
  })
})

describe('consent requests', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(VERIFICATION_STATE), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    fetchMock.mockReset()
    vi.unstubAllGlobals()
  })

  function sentBody(): Record<string, unknown> {
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    return JSON.parse(init.body as string) as Record<string, unknown>
  }

  it('recordConsent states that the receiver agreed, and whether they hold a document', async () => {
    await recordConsent('tok123', 'wording', false)

    expect(sentBody()).toEqual({ consent_text: 'wording', consented: true, has_document: false })
  })

  it('recordConsentDecline states that the receiver refused', async () => {
    await recordConsentDecline('tok123', 'wording')

    expect(sentBody()).toEqual({ consent_text: 'wording', consented: false })
  })
})

const TYPED_NAME = 'Thandi Nkosi'
const TYPED_ID = '9202204720082'
const SECRET_TOKEN = 'tok-secret-capability'

const CONFIRM_PAYLOAD: ConfirmPayload = {
  receiver_name: TYPED_NAME,
  receiver_id_number: TYPED_ID,
  signature_png_base64: 'data:image/png;base64,AAAA',
  receiver_lat: null,
  receiver_lng: null,
  receiver_accuracy_m: null,
}

const VALIDATION_422_BODY = {
  detail: [
    {
      type: 'string_too_long',
      loc: ['body', 'receiver_name'],
      msg: 'String should have at most 120 characters',
      input: `${TYPED_NAME} ${TYPED_ID}`,
      ctx: { max_length: 120 },
    },
    {
      type: 'missing',
      loc: ['body', 'receiver_id_number'],
      msg: 'Field required',
      input: TYPED_ID,
    },
  ],
}

function jsonResponse(body: unknown, init: ResponseInit): Response {
  return new Response(JSON.stringify(body), init)
}

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise
  } catch (err: unknown) {
    return err
  }
  throw new Error('Expected the promise to reject')
}

describe('failure handling', () => {
  const fetchMock = vi.fn()
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    fetchMock.mockReset()
    warnSpy.mockRestore()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  describe('422 validation errors', () => {
    it('builds a readable message from the detail array and leaves out the echoed input', async () => {
      fetchMock.mockResolvedValue(jsonResponse(VALIDATION_422_BODY, { status: 422 }))

      const err = await captureRejection(confirmHandover(SECRET_TOKEN, CONFIRM_PAYLOAD))

      expect(err).toBeInstanceOf(HandoverError)
      expect((err as HandoverError).status).toBe(422)
      expect((err as HandoverError).message).toBe(
        'String should have at most 120 characters; Field required',
      )
      expect((err as HandoverError).message).not.toContain(TYPED_NAME)
      expect((err as HandoverError).message).not.toContain(TYPED_ID)
      expect((err as HandoverError).message).not.toContain('[object Object]')
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(TYPED_ID)
    })

    it('falls back to the status text when no detail entry has a message', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ detail: [{ loc: ['body'], input: TYPED_ID }] }, {
          status: 422,
          statusText: 'Unprocessable Entity',
        }),
      )

      const err = await captureRejection(confirmHandover(SECRET_TOKEN, CONFIRM_PAYLOAD))

      expect((err as HandoverError).message).toBe('Unprocessable Entity')
    })

    it('keeps a plain string detail as it is', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'Not found' }, { status: 404 }))

      const err = await captureRejection(fetchScan(SECRET_TOKEN))

      expect((err as HandoverError).message).toBe('Not found')
    })

    it('does not throw while reading a body that is not JSON, and never shows an empty message', async () => {
      fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502 }))

      const err = await captureRejection(fetchScan(SECRET_TOKEN))

      expect(err).toBeInstanceOf(HandoverError)
      expect((err as HandoverError).status).toBe(502)
      expect((err as HandoverError).message).toBe('Request failed (502)')
    })
  })

  describe('requests that never get an answer', () => {
    it('reports a fetch TypeError as status 0 with a message that does not contain the token', async () => {
      fetchMock.mockRejectedValue(new TypeError(`Failed to fetch /handover/${SECRET_TOKEN}`))

      const err = await captureRejection(fetchScan(SECRET_TOKEN))

      expect(err).toBeInstanceOf(HandoverError)
      expect((err as HandoverError).status).toBe(0)
      expect((err as HandoverError).message).not.toContain(SECRET_TOKEN)
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(SECRET_TOKEN)
    })

    it.each(['TimeoutError', 'AbortError'])('reports a %s as status 0', async (name) => {
      fetchMock.mockRejectedValue(new DOMException('aborted', name))

      const err = await captureRejection(confirmHandover(SECRET_TOKEN, CONFIRM_PAYLOAD))

      expect((err as HandoverError).status).toBe(0)
    })

    it('reports a 2xx whose body cannot be read as status 0, not as success', async () => {
      fetchMock.mockResolvedValue(new Response('<html>captive portal</html>', { status: 200 }))

      const err = await captureRejection(fetchScan(SECRET_TOKEN))

      expect((err as HandoverError).status).toBe(0)
    })
  })

  describe('timeouts', () => {
    it('passes an AbortSignal on the scan GET and on every POST', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse({ status: 'verified' }, { status: 200 })),
      )

      await fetchScan(SECRET_TOKEN)
      await confirmHandover(SECRET_TOKEN, CONFIRM_PAYLOAD)
      await recordConsent(SECRET_TOKEN, 'wording', true)

      for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
        expect(init.signal).toBeInstanceOf(AbortSignal)
      }
    })

    it('uses AbortSignal.timeout with a shorter limit for the scan than for writes', async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, 'timeout')
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse({ status: 'verified' }, { status: 200 })),
      )

      await fetchScan(SECRET_TOKEN)
      await confirmHandover(SECRET_TOKEN, CONFIRM_PAYLOAD)

      const [scanLimit, writeLimit] = timeoutSpy.mock.calls.map(([ms]) => ms)
      expect(scanLimit).toBeGreaterThan(0)
      expect(writeLimit).toBeGreaterThan(scanLimit)
      timeoutSpy.mockRestore()
    })

    it('still sends a working signal on a browser without AbortSignal.timeout', async () => {
      vi.useFakeTimers()
      const original = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')
      Object.defineProperty(AbortSignal, 'timeout', { value: undefined, configurable: true })
      fetchMock.mockImplementation(() =>
        Promise.resolve(jsonResponse({ status: 'verified' }, { status: 200 })),
      )

      try {
        await fetchScan(SECRET_TOKEN)
      } finally {
        if (original) Object.defineProperty(AbortSignal, 'timeout', original)
      }

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect(init.signal).toBeInstanceOf(AbortSignal)
      expect(init.signal?.aborted).toBe(false)
      vi.advanceTimersByTime(60_000)
      expect(init.signal?.aborted).toBe(true)
    })
  })

  describe('rate limiting', () => {
    it('reads Retry-After in seconds into retryAfterMs', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ detail: 'Too many requests' }, { status: 429, headers: { 'Retry-After': '7' } }),
      )

      const err = await captureRejection(confirmHandover(SECRET_TOKEN, CONFIRM_PAYLOAD))

      expect((err as HandoverError).status).toBe(429)
      expect((err as HandoverError).retryAfterMs).toBe(7_000)
    })

    it('reads Retry-After given as an HTTP date', async () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T10:00:00Z'))
      fetchMock.mockResolvedValue(
        jsonResponse({ detail: 'Too many requests' }, {
          status: 429,
          headers: { 'Retry-After': 'Thu, 01 Jan 2026 10:00:12 GMT' },
        }),
      )

      const err = await captureRejection(confirmHandover(SECRET_TOKEN, CONFIRM_PAYLOAD))

      expect((err as HandoverError).retryAfterMs).toBe(12_000)
    })

    it.each([[null], ['soon']])('leaves retryAfterMs unset for a missing or unreadable header (%s)', async (header) => {
      const headers: Record<string, string> = header === null ? {} : { 'Retry-After': header }
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'Too many requests' }, { status: 429, headers }))

      const err = await captureRejection(confirmHandover(SECRET_TOKEN, CONFIRM_PAYLOAD))

      expect((err as HandoverError).retryAfterMs).toBeUndefined()
    })

    it('ignores Retry-After on other statuses', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ detail: 'Unavailable' }, { status: 503, headers: { 'Retry-After': '9' } }),
      )

      const err = await captureRejection(confirmHandover(SECRET_TOKEN, CONFIRM_PAYLOAD))

      expect((err as HandoverError).retryAfterMs).toBeUndefined()
    })
  })
})

describe('failure predicates', () => {
  it('isTokenRejected is true only for a 404 HandoverError', () => {
    expect(isTokenRejected(new HandoverError(404, 'x'))).toBe(true)
    expect(isTokenRejected(new HandoverError(0, 'x'))).toBe(false)
    expect(isTokenRejected(new HandoverError(422, 'x'))).toBe(false)
    expect(isTokenRejected(new HandoverError(503, 'x'))).toBe(false)
    expect(isTokenRejected(new Error('404'))).toBe(false)
    expect(isTokenRejected(null)).toBe(false)
  })

  it('isTransientFailure is true for no answer, 429 and 5xx — and for nothing else', () => {
    expect(isTransientFailure(new HandoverError(0, 'x'))).toBe(true)
    expect(isTransientFailure(new HandoverError(429, 'x'))).toBe(true)
    expect(isTransientFailure(new HandoverError(500, 'x'))).toBe(true)
    expect(isTransientFailure(new HandoverError(503, 'x'))).toBe(true)
    expect(isTransientFailure(new HandoverError(404, 'x'))).toBe(false)
    expect(isTransientFailure(new HandoverError(422, 'x'))).toBe(false)
    expect(isTransientFailure(new HandoverError(499, 'x'))).toBe(false)
    expect(isTransientFailure(new TypeError('x'))).toBe(false)
    expect(isTransientFailure(undefined)).toBe(false)
  })
})

describe('API base URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('refuses to load in a production build with no NEXT_PUBLIC_API_URL', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_API_URL', '')
    vi.resetModules()

    await expect(import('./api')).rejects.toThrow(/NEXT_PUBLIC_API_URL/)
  })

  it('loads in a production build when NEXT_PUBLIC_API_URL is set', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.invalid')
    vi.resetModules()

    await expect(import('./api')).resolves.toBeDefined()
  })

  it('falls back to localhost outside production so local development needs no setup', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', '')
    vi.resetModules()
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const fresh = await import('./api')
    await fresh.fetchScan('tok')
    vi.unstubAllGlobals()

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:8000/api/v1/handover/tok')
  })
})
