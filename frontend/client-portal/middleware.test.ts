import { describe, expect, it } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware } from './middleware'

describe('CSP middleware', () => {
  it('sends a policy with a fresh nonce, and hands the same nonce to the render', () => {
    const response = middleware(new NextRequest('http://localhost/'))

    const policy = response.headers.get('Content-Security-Policy') ?? ''
    const nonce = /'nonce-([^']+)'/.exec(policy)?.[1]
    expect(nonce).toBeTruthy()
    // NextResponse.next({ request: { headers } }) forwards overridden request headers this way.
    expect(response.headers.get('x-middleware-request-x-nonce')).toBe(nonce)
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy)
  })

  it('never reuses a nonce across responses', () => {
    const first = middleware(new NextRequest('http://localhost/')).headers.get('Content-Security-Policy')
    const second = middleware(new NextRequest('http://localhost/')).headers.get('Content-Security-Policy')

    expect(first).not.toBe(second)
  })
})
