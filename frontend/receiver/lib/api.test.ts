// frontend/receiver/lib/api.test.ts
//
// resolveVerification carries a stranger's name and ID number. A URL is logged by the
// server, proxies and the hosting platform; a request body is not — so where those two
// values travel is the thing under test, not an implementation detail.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordConsent, recordConsentDecline, resolveVerification } from './api'

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
