import { describe, it, expect } from 'vitest'
import { nextHandshakeRoute } from '../handshake-flow'

describe('nextHandshakeRoute', () => {
  it('advances to the next step within a handshake', () => {
    expect(nextHandshakeRoute('trip-1', 1, '1-approach-gate'))
      .toBe('/trip/trip-1/handshake/1/step/2-entry-photo')
  })
  it('rolls from the last step of H1 into the first step of H2', () => {
    expect(nextHandshakeRoute('trip-1', 1, '3-verification'))
      .toBe('/trip/trip-1/handshake/2/step/1-arrive-bay')
  })
  it('rolls from the last step of H2 into the first step of H3', () => {
    expect(nextHandshakeRoute('trip-1', 2, '5-review'))
      .toBe('/trip/trip-1/handshake/3/step/1-approach-exit')
  })
  it('throws on an unrecognized step slug instead of silently skipping the handshake', () => {
    expect(() => nextHandshakeRoute('trip-1', 1, '1-aproach-gate'))
      .toThrow('Unknown step slug "1-aproach-gate" for handshake 1')
  })
  it('hands off to the in-transit hub at the end of H3', () => {
    expect(nextHandshakeRoute('trip-1', 3, '3-departure'))
      .toBe('/trip/trip-1/in-transit')
  })
  it('returns to the trip list at the end of H5', () => {
    expect(nextHandshakeRoute('trip-1', 5, '6-closed'))
      .toBe('/trips')
  })
})
