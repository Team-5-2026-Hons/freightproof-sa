import { describe, it, expect } from 'vitest'
import { nextHandshakeRoute } from '../handshake-flow'

describe('nextHandshakeRoute', () => {
  it('advances to the next step within a handshake', () => {
    expect(nextHandshakeRoute(1, '1-approach-gate'))
      .toBe('/trip/handshake/1/step/2-entry-photo')
  })
  it('returns to the trip detail page at the end of H1, instead of rolling into H2', () => {
    expect(nextHandshakeRoute(1, '3-verification'))
      .toBe('/trips/active')
  })
  it('returns to the trip detail page at the end of H2, instead of rolling into H3', () => {
    expect(nextHandshakeRoute(2, '5-review'))
      .toBe('/trips/active')
  })
  it('returns to the trip detail page at the end of H4, instead of rolling into H5', () => {
    expect(nextHandshakeRoute(4, '3-seal-verify'))
      .toBe('/trips/active')
  })
  it('throws on an unrecognized step slug instead of silently skipping the handshake', () => {
    expect(() => nextHandshakeRoute(1, '1-aproach-gate'))
      .toThrow('Unknown step slug "1-aproach-gate" for handshake 1')
  })
  it('hands off to the in-transit hub at the end of H3', () => {
    expect(nextHandshakeRoute(3, '3-departure'))
      .toBe('/trip/in-transit')
  })
  it('returns to the trip list at the end of H5', () => {
    expect(nextHandshakeRoute(5, '6-closed'))
      .toBe('/trips')
  })
})
