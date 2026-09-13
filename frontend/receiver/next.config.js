const path = require('path')

// The receiver app is opened by strangers, from a QR code, on a link they did not type
// and cannot verify. Its headers are stricter than the dispatcher's in the two places
// that matter, and looser in exactly one.
const securityHeaders = [
  // Never legitimately embedded anywhere.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // no-referrer, not strict-origin-when-cross-origin as on the dispatcher: the PATH here
  // contains a live capability token, and a Referer header would walk it out to any
  // third-party origin this page ever touches. Nothing on this page is worth that.
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // Geolocation is ALLOWED here, unlike on the dispatcher, which denies it outright. The
  // receiver's independent position fix is the single most valuable thing this page
  // collects — a third source on the most disputed moment in the trip, from a party with
  // no incentive to help the driver. Camera and microphone stay denied: this page renders
  // a signature, it never captures media.
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
