import { NextResponse, type NextRequest } from 'next/server'
import { NONCE_HEADER, apiOriginFrom, buildCsp, createNonce } from '@/lib/csp'

const LOCAL_DEV_API_URL = 'http://localhost:8000'

export function middleware(request: NextRequest): NextResponse {
  const nonce = createNonce()
  const policy = buildCsp({
    nonce,
    apiOrigin: apiOriginFrom(process.env.NEXT_PUBLIC_API_URL, LOCAL_DEV_API_URL),
    isDev: process.env.NODE_ENV === 'development',
  })
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(NONCE_HEADER, nonce)
  requestHeaders.set('Content-Security-Policy', policy)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', policy)
  return response
}

export const config = {
  matcher: [{
    source: '/((?!_next/static|_next/image|favicon.ico).*)',
    missing: [
      { type: 'header', key: 'next-router-prefetch' },
      { type: 'header', key: 'purpose', value: 'prefetch' },
    ],
  }],
}
