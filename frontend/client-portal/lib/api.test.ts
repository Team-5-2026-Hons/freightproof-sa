import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const GRANT_KEY = 'fp-audit-pack-grant:tok'
const fetchMock = vi.fn()

// api.ts keeps the viewer grant (and the "storage is blocked" flag) in module state. A fresh
// import per test stops one test's grant from being sent by the next.
type Api = typeof import('./api')
let api: Api
let PackError: Api['PackError']
type PackErrorInstance = InstanceType<Api['PackError']>
let downloadPackFile: Api['downloadPackFile']
let fetchPack: Api['fetchPack']
let fetchArtifactBytes: Api['fetchArtifactBytes']
let verifyPassword: Api['verifyPassword']

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function sentHeaders(call: number): Record<string, string> {
  return (fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>
}

beforeEach(async () => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
  vi.resetModules()
  api = await import('./api')
  ;({ PackError, downloadPackFile, fetchPack, fetchArtifactBytes, verifyPassword } = api)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('viewer grant (FP-291)', () => {
  it('sends no grant header before a password was entered', async () => {
    // Arrange
    fetchMock.mockResolvedValue(json(200, {}))

    // Act
    await fetchPack('tok')

    // Assert
    expect(sentHeaders(0)).toEqual({})
  })

  it('keeps the grant from a verified password and sends it as a header, never in the URL', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(json(200, { grant: 'g-123', expires_at: '2026-11-01T00:00:00Z' }))
      .mockResolvedValueOnce(json(200, {}))

    // Act
    await verifyPassword('tok', 'sWordf1sh')
    await fetchPack('tok')

    // Assert
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ password: 'sWordf1sh' })
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/tok\/password\/verify$/)
    expect(sentHeaders(1)).toEqual({ 'X-Audit-Pack-Grant': 'g-123' })
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('g-123')
  })

  it('turns a verification-required 401 into a PackError carrying the email hint and drops a stale grant', async () => {
    // Arrange
    window.localStorage.setItem(GRANT_KEY, 'stale')
    fetchMock.mockResolvedValue(json(401, { detail: 'Enter the password', verification_required: true, email_hint: 'j***@x.co' }))

    // Act
    const error = await fetchPack('tok').catch((e: unknown) => e)

    // Assert
    expect(error).toBeInstanceOf(PackError)
    expect((error as PackErrorInstance).verificationRequired).toBe(true)
    expect((error as PackErrorInstance).emailHint).toBe('j***@x.co')
    expect(window.localStorage.getItem(GRANT_KEY)).toBeNull()
  })

  it('keeps an ordinary error (410) as an error, not a password prompt', async () => {
    // Arrange
    fetchMock.mockResolvedValue(json(410, { detail: 'This audit pack link has expired.' }))

    // Act
    const error = await fetchPack('tok').catch((e: unknown) => e)

    // Assert
    expect((error as PackErrorInstance).status).toBe(410)
    expect((error as PackErrorInstance).verificationRequired).toBe(false)
  })

  it('downloads a PDF with the grant header', async () => {
    // Arrange
    window.localStorage.setItem(GRANT_KEY, 'g-123')
    // A plain stub: jsdom's Blob and Node's Response do not mix.
    fetchMock.mockResolvedValue({ ok: true, status: 200, blob: () => Promise.resolve(new Blob(['%PDF'])) })
    const createObjectURL = vi.fn(() => 'blob:x')
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = vi.fn()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    // Act
    await downloadPackFile('tok', 'pdf', 'FP-AUDIT-AP1.pdf')

    // Assert
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/tok\/pdf$/)
    expect(sentHeaders(0)).toEqual({ 'X-Audit-Pack-Grant': 'g-123' })
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(click).toHaveBeenCalledOnce()
    click.mockRestore()
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
  })
})

describe('viewer grant when site storage is blocked', () => {
  function blockStorage() {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('Access is denied for this document.', 'SecurityError')
    })
  }

  it('still sends the grant on the next request, from the in-memory copy', async () => {
    // Arrange
    blockStorage()
    fetchMock
      .mockResolvedValueOnce(json(200, { grant: 'g-123', expires_at: '2026-11-01T00:00:00Z' }))
      .mockResolvedValueOnce(json(200, {}))

    // Act
    await verifyPassword('tok', 'sWordf1sh')
    await fetchPack('tok')

    // Assert
    expect(sentHeaders(1)).toEqual({ 'X-Audit-Pack-Grant': 'g-123' })
  })

  it('reports that storage is blocked, so the page can warn about the next visit', async () => {
    // Arrange
    blockStorage()
    fetchMock.mockResolvedValueOnce(json(200, { grant: 'g-123', expires_at: '2026-11-01T00:00:00Z' }))
    expect(api.storageBlocked()).toBe(false)

    // Act
    await verifyPassword('tok', 'sWordf1sh')

    // Assert
    expect(api.storageBlocked()).toBe(true)
  })

  it('does not report blocked storage when the grant was stored', async () => {
    // Arrange
    fetchMock.mockResolvedValueOnce(json(200, { grant: 'g-123', expires_at: '2026-11-01T00:00:00Z' }))

    // Act
    await verifyPassword('tok', 'sWordf1sh')

    // Assert
    expect(api.storageBlocked()).toBe(false)
    expect(window.localStorage.getItem(GRANT_KEY)).toBe('g-123')
  })

  it('forgets the in-memory grant too once the server rejects it', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(json(200, { grant: 'g-123', expires_at: '2026-11-01T00:00:00Z' }))
      .mockResolvedValueOnce(json(401, { detail: 'Enter the password', verification_required: true, email_hint: 'j***@x.co' }))
      .mockResolvedValueOnce(json(200, {}))
    await verifyPassword('tok', 'sWordf1sh')
    await fetchPack('tok').catch(() => undefined)

    // Act
    await fetchPack('tok')

    // Assert
    expect(sentHeaders(2)).toEqual({})
  })
})

describe('fetchArtifactBytes', () => {
  it('returns the bytes of an evidence file', async () => {
    // Arrange: a plain stub, because jsdom's ArrayBuffer and Node's Response do not mix.
    const bytes = new ArrayBuffer(4)
    fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(bytes) })
    const controller = new AbortController()

    // Act
    const result = await fetchArtifactBytes('tok', 'art-1', controller.signal)

    // Assert
    expect(result).toBe(bytes)
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal)
  })

  it.each([[410], [429], [503]])('keeps the real status %i instead of one generic error', async (status) => {
    // Arrange
    fetchMock.mockResolvedValue(json(status, { detail: 'nope' }))

    // Act
    const error = await fetchArtifactBytes('tok', 'art-1').catch((e: unknown) => e)

    // Assert
    expect(error).toBeInstanceOf(PackError)
    expect((error as PackErrorInstance).status).toBe(status)
  })

  it('keeps verification_required on a 401 so an expired grant is told apart from a missing file', async () => {
    // Arrange
    fetchMock.mockResolvedValue(json(401, { detail: 'Enter the password', verification_required: true, email_hint: 'j***@x.co' }))

    // Act
    const error = await fetchArtifactBytes('tok', 'art-1').catch((e: unknown) => e)

    // Assert
    expect((error as PackErrorInstance).status).toBe(401)
    expect((error as PackErrorInstance).verificationRequired).toBe(true)
  })
})

describe('error bodies', () => {
  it('joins the messages of a 422 validation list instead of printing [object Object]', async () => {
    // Arrange
    fetchMock.mockResolvedValue(json(422, { detail: [{ loc: ['path', 'pack_id'], msg: 'Input should be a valid UUID', type: 'uuid_parsing' }] }))

    // Act
    const error = await fetchPack('tok').catch((e: unknown) => e)

    // Assert
    expect((error as PackErrorInstance).message).toBe('Input should be a valid UUID')
  })

  it('reads detail text from a string, a list, or nothing', () => {
    expect(api.detailText('plain')).toBe('plain')
    expect(api.detailText([{ msg: 'a' }, { msg: 'b' }])).toBe('a; b')
    expect(api.detailText([])).toBeNull()
    expect(api.detailText(undefined)).toBeNull()
  })

  it('falls back to the HTTP status text when the body is not JSON', async () => {
    // Arrange
    fetchMock.mockResolvedValue(new Response('gateway', { status: 502, statusText: 'Bad Gateway' }))

    // Act
    const error = await fetchPack('tok').catch((e: unknown) => e)

    // Assert
    expect((error as PackErrorInstance).message).toBe('Bad Gateway')
  })
})

describe('API base URL', () => {
  it('refuses to load in a production build without NEXT_PUBLIC_API_URL', async () => {
    // Arrange
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_API_URL', '')
    vi.resetModules()

    // Act / Assert
    await expect(import('./api')).rejects.toThrow('NEXT_PUBLIC_API_URL')
  })

  it('loads in a production build when it is set, and uses it', async () => {
    // Arrange
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.example.invalid')
    vi.resetModules()
    const production = await import('./api')
    fetchMock.mockResolvedValue(json(200, {}))

    // Act
    await production.fetchPack('tok')

    // Assert
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.invalid/api/v1/public/audit-packs/tok')
  })

  it('falls back to the local API outside production', async () => {
    // Arrange
    vi.stubEnv('NEXT_PUBLIC_API_URL', '')
    vi.resetModules()
    const development = await import('./api')
    fetchMock.mockResolvedValue(json(200, {}))

    // Act
    await development.fetchPack('tok')

    // Assert
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^http:\/\/localhost:8000\//)
  })
})
