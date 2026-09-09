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
    ['a relative path that could resolve anywhere', 'trips/abc'],
    ['an empty value', ''],
    ['a missing parameter', null],
  ]
  it.each(rejected)('falls back rather than following %s', (_label, value) => {
    expect(safeReturnTo(value, '/fallback')).toBe('/fallback')
  })

  it('never returns a value that resolves off-origin', () => {
    for (const [, value] of rejected) {
      const result = safeReturnTo(value, '/fallback')
      expect(new URL(result, 'https://dispatcher.test').origin).toBe('https://dispatcher.test')
    }
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
