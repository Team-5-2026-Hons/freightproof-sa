const path = require('path')
const { PHASE_PRODUCTION_BUILD } = require('next/constants')

// Opened by strangers from an unverifiable QR link, so headers are stricter than the
// dispatcher's in most places, looser only for geolocation.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // no-referrer: the path carries a live capability token that a Referer header would
  // leak to any third-party origin this page touches.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // Geolocation allowed (unlike dispatcher, which denies it): the receiver's independent
  // position fix is a third, disinterested source on the most disputed trip moment.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The default X-Powered-By: Next.js header tells a prober which framework (and so which
  // class of vulnerability) to try. Nothing here needs it.
  poweredByHeader: false,
  // Pin the monorepo root so Next never walks up and adopts an unrelated lockfile.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Required to compile the shared renderer from ../shared.
  experimental: { externalDir: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

/**
 * Refuses a production build without the API URL. lib/api.ts throws too, but only when the
 * module first runs in a browser: every page renders on demand, so `next build` never
 * evaluates it and CI went green on a bundle that would fail on every receiver's phone.
 */
function assertApiUrl(phase, env = process.env) {
  if (phase === PHASE_PRODUCTION_BUILD && !env.NEXT_PUBLIC_API_URL) {
    throw new Error('NEXT_PUBLIC_API_URL must be set for a production build of the receiver app.')
  }
}

module.exports = (phase) => {
  assertApiUrl(phase)
  return nextConfig
}
module.exports.assertApiUrl = assertApiUrl
