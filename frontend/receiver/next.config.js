const path = require('path')

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
  // Pin the monorepo root so Next never walks up and adopts an unrelated lockfile.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Required to compile the shared renderer from ../shared.
  experimental: { externalDir: true },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
