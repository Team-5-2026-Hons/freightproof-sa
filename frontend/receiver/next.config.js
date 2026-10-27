const path = require('path')
const { PHASE_PRODUCTION_BUILD } = require('next/constants')

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
]

const nextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: path.join(__dirname, '../..'),
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
