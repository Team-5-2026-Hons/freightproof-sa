import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PackError, downloadPackFile, fetchPack, requestEmailCode, verifyEmailCode } from './api'

const GRANT_KEY = 'fp-audit-pack-grant:tok'
const fetchMock = vi.fn()

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function sentHeaders(call: number): Record<string, string> {
  return (fetchMock.mock.calls[call][1] as RequestInit).headers as Record<string, string>
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  window.localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('viewer grant (FP-291)', () => {
  it('sends no grant header before a code was entered', async () => {
    // Arrange
    fetchMock.mockResolvedValue(json(200, {}))

    // Act
    await fetchPack('tok')

    // Assert
    expect(sentHeaders(0)).toEqual({})
  })

  it('keeps the grant from a verified code and sends it as a header, never in the URL', async () => {
    // Arrange
    fetchMock
      .mockResolvedValueOnce(json(200, { grant: 'g-123', expires_at: '2026-11-01T00:00:00Z' }))
      .mockResolvedValueOnce(json(200, {}))

    // Act
    await verifyEmailCode('tok', '048213')
    await fetchPack('tok')

    // Assert
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ code: '048213' })
    expect(sentHeaders(1)).toEqual({ 'X-Audit-Pack-Grant': 'g-123' })
    expect(String(fetchMock.mock.calls[1][0])).not.toContain('g-123')
  })

  it('turns a verification-required 401 into a PackError carrying the email hint and drops a stale grant', async () => {
    // Arrange
    window.localStorage.setItem(GRANT_KEY, 'stale')
    fetchMock.mockResolvedValue(json(401, { detail: 'Enter the code', verification_required: true, email_hint: 'j***@x.co' }))

    // Act
    const error = await fetchPack('tok').catch((e: unknown) => e)

    // Assert
    expect(error).toBeInstanceOf(PackError)
    expect((error as PackError).verificationRequired).toBe(true)
    expect((error as PackError).emailHint).toBe('j***@x.co')
    expect(window.localStorage.getItem(GRANT_KEY)).toBeNull()
  })

  it('keeps an ordinary error (410) as an error, not a code prompt', async () => {
    // Arrange
    fetchMock.mockResolvedValue(json(410, { detail: 'This audit pack link has expired.' }))

    // Act
    const error = await fetchPack('tok').catch((e: unknown) => e)

    // Assert
    expect((error as PackError).status).toBe(410)
    expect((error as PackError).verificationRequired).toBe(false)
  })

  it('asks the API to email a code', async () => {
    // Arrange
    fetchMock.mockResolvedValue(json(202, { email_hint: 'j***@x.co' }))

    // Act
    const sent = await requestEmailCode('tok')

    // Assert
    expect(sent.email_hint).toBe('j***@x.co')
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/tok\/email-code$/)
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('POST')
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
