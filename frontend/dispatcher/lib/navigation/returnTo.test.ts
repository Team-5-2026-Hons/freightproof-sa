import { describe, expect, it } from 'vitest'
import { safeReturnTo, withReturnTo } from './returnTo'

describe('safeReturnTo', () => {
  it('honours an internal absolute path', () => {
    expect(safeReturnTo('/trips/abc?panel=information', '/fallback')).toBe('/trips/abc?panel=information')
  })

  it('preserves a fragment alongside the query', () => {
    expect(safeReturnTo('/trips/abc?panel=manifest#phase-2', '/fallback')).toBe('/trips/abc?panel=manifest#phase-2')
  })

  const rejected: readonly (readonly [string, string | null])[] = [
    ['an absolute URL', 'https://example.com/phish'],
    ['a protocol-relative URL that leaves the origin', '//example.com/phish'],
    // The prefix check this replaced accepted every one of these: each starts with a
    // single "/" and each resolves to a different origin once actually parsed.
    ['a backslash that the URL parser reads as a second slash', '/\\example.com/phish'],
    ['a backslash pair', '/\\\\example.com/phish'],
    ['a tab smuggled between the slashes', '/\t/example.com/phish'],
    ['a newline smuggled between the slashes', '/\n/example.com/phish'],
    // Climbing above root leaves a pathname of "//host". The input resolves on-origin,
    // so only checking what is RETURNED rejects these.
    ['a parent segment that climbs above root', '/a/..//example.com'],
    ['a bare climb above root', '/..//example.com'],
    ['a climb above root carrying a path and query', '/a/b/../..//evil.com/x?q=1'],
    ['a relative path that could resolve anywhere', 'trips/abc'],
    ['an empty value', ''],
    ['a missing parameter', null],
  ]
  it.each(rejected)('falls back rather than following %s', (_label, value) => {
    expect(safeReturnTo(value, '/fallback')).toBe('/fallback')
  })

  // The property the two origin checks exist to hold. Deliberately spans ACCEPTED inputs
  // as well as rejected ones: an earlier version of this test looped over the rejected
  // list alone, so every case returned the fallback and it could not fail — which is how
  // the climb-above-root family got through in the first place.
  it('never returns a value that resolves off-origin, whatever it accepts', () => {
    const everyInput: readonly (string | null)[] = [
      ...rejected.map(([, value]) => value),
      '/trips/abc?panel=information',
      '/trips/abc?panel=manifest#phase-2',
      '/a/..//example.com',
      '/a/../trips/abc',
      '/',
    ]

    for (const value of everyInput) {
      const result = safeReturnTo(value, '/fallback')
      expect(new URL(result, 'https://dispatcher.test').origin).toBe('https://dispatcher.test')
    }
  })

  it('still honours a legitimate parent segment that stays on the origin', () => {
    expect(safeReturnTo('/a/../trips/abc', '/fallback')).toBe('/trips/abc')
  })
})

describe('withReturnTo', () => {
  it('starts a query string when the target has none', () => {
    expect(withReturnTo('/precincts/1', '/trips/a')).toBe('/precincts/1?returnTo=%2Ftrips%2Fa')
  })

  it('appends to a query the target already carries', () => {
    expect(withReturnTo('/precincts/1?tab=map', '/trips/a')).toBe('/precincts/1?tab=map&returnTo=%2Ftrips%2Fa')
  })

  it('leaves the target alone when there is nowhere to return to', () => {
    expect(withReturnTo('/precincts/1', null)).toBe('/precincts/1')
  })
})
