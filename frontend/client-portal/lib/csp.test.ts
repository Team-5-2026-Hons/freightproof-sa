import { describe, expect, it } from 'vitest'
import { apiOriginFrom, buildCsp, createNonce, tileSourceFrom } from './csp'
import { OSM_TILES } from './tiles'
import { TRUSTED_MIRRORS } from './verify'

function directives(policy: string): Map<string, string[]> {
  return new Map(policy.split('; ').map((d) => {
    const [name, ...sources] = d.split(' ')
    return [name, sources] as const
  }))
}

const MIRRORS = Object.values(TRUSTED_MIRRORS).flat()

describe('client-portal CSP', () => {
  const policy = directives(buildCsp({
    nonce: 'abc123', apiOrigin: 'https://api.example.test', mirrorOrigins: MIRRORS,
    tileSource: tileSourceFrom(OSM_TILES), isDev: false,
  }))

  it('runs only scripts from this origin carrying this response\'s nonce', () => {
    expect(policy.get('script-src')).toEqual(["'self'", "'nonce-abc123'"])
  })

  it('reaches the API and exactly the trusted Hedera mirrors, nothing else', () => {
    expect(policy.get('connect-src')).toEqual(["'self'", 'https://api.example.test', ...MIRRORS])
    expect(policy.get('connect-src')).toContain('https://mainnet-public.mirrornode.hedera.com')
  })

  it('shows evidence blobs, Leaflet imagery and map tiles', () => {
    expect(policy.get('img-src')).toEqual(["'self'", 'blob:', 'data:', 'https://tile.openstreetmap.org'])
  })

  it('cannot be framed, rebased or used to load plugins', () => {
    expect(policy.get('frame-ancestors')).toEqual(["'none'"])
    expect(policy.get('base-uri')).toEqual(["'none'"])
    expect(policy.get('object-src')).toEqual(["'none'"])
  })

  it('widens a {s} tile subdomain to a wildcard and refuses a relative template', () => {
    expect(tileSourceFrom('https://{s}.tiles.example.test/{z}/{x}/{y}.png')).toBe('https://*.tiles.example.test')
    expect(() => tileSourceFrom('/tiles/{z}/{x}/{y}.png')).toThrow()
  })

  it('reduces the API URL to its origin, with the dev fallback when unset', () => {
    expect(apiOriginFrom('https://api.example.test/v1', 'http://localhost:8000')).toBe('https://api.example.test')
    expect(apiOriginFrom('', 'http://localhost:8000')).toBe('http://localhost:8000')
  })

  it('issues a different nonce every time', () => {
    expect(createNonce()).not.toBe(createNonce())
  })
})
