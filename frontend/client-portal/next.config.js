const path = require('path')

// Opened by outsiders (insurers, adjusters, detectives) from a link that IS the
// credential, so headers are as strict as the receiver app's.
const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // no-referrer: the /p/<token> path carries a live share token that a Referer header
  // would leak to the map-tile server and the Hedera mirror node this page calls.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the monorepo root so Next never walks up and adopts an unrelated lockfile.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: { externalDir: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
