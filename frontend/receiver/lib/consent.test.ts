// frontend/receiver/lib/consent.test.ts
//
// consentPayloadText() is what the server hashes as evidence of which wording a receiver
// saw (see the file-level comment in consent.ts), so the version prefix and the exact text
// it wraps are both load-bearing, not incidental formatting.
import { describe, expect, it } from 'vitest'
import { CONSENT_TEXT, CONSENT_VERSION, consentPayloadText } from './consent'

describe('consentPayloadText', () => {
  it('prefixes the consent text with the version, colon-separated', () => {
    const payload = consentPayloadText()

    expect(payload).toBe(`${CONSENT_VERSION}: ${CONSENT_TEXT}`)
  })

  it('names the transfer destination and the provider, for POPIA s72(1)(b)', () => {
    const payload = consentPayloadText()

    expect(payload).toContain('Didit')
    expect(payload).toContain('outside South Africa')
  })

  it('states that declining still allows the delivery to be confirmed', () => {
    const payload = consentPayloadText()

    expect(payload).toContain('You can decline')
  })

  it('is stable across calls, since the same string must hash the same way every time', () => {
    expect(consentPayloadText()).toBe(consentPayloadText())
  })
})
