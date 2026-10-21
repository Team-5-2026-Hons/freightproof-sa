import { describe, expect, it } from 'vitest'
import { apiOriginFrom, buildCsp, createNonce } from './csp'

function directives(policy: string): Map<string, string[]> {
  return new Map(policy.split('; ').map((d) => {
    const [name, ...sources] = d.split(' ')
    return [name, sources] as const
  }))
}

describe('receiver CSP', () => {
  const policy = directives(buildCsp({ nonce: 'abc123', apiOrigin: 'https://api.example.test', isDev: false }))

  it('runs only scripts from this origin carrying this response\'s nonce', () => {
    expect(policy.get('script-src')).toEqual(["'self'", "'nonce-abc123'"])
  })

  it('calls only this origin and the API', () => {
    expect(policy.get('connect-src')).toEqual(["'self'", 'https://api.example.test'])
  })

  it('cannot be framed, rebased or used to load plugins', () => {
    expect(policy.get('frame-ancestors')).toEqual(["'none'"])
    expect(policy.get('base-uri')).toEqual(["'none'"])
    expect(policy.get('object-src')).toEqual(["'none'"])
  })

  it('shows the signature image drawn in the page', () => {
    expect(policy.get('img-src')).toEqual(["'self'", 'blob:', 'data:'])
  })

  it('allows eval only for next dev', () => {
    const dev = directives(buildCsp({ nonce: 'n', apiOrigin: 'http://localhost:8000', isDev: true }))

    expect(dev.get('script-src')).toContain("'unsafe-eval'")
    expect(policy.get('script-src')).not.toContain("'unsafe-eval'")
  })

  it('reduces the API URL to its origin, with the dev fallback when unset', () => {
    expect(apiOriginFrom('https://api.example.test/some/path', 'http://localhost:8000')).toBe('https://api.example.test')
    expect(apiOriginFrom(undefined, 'http://localhost:8000')).toBe('http://localhost:8000')
  })

  it('issues a different nonce every time', () => {
    expect(createNonce()).not.toBe(createNonce())
  })
})
