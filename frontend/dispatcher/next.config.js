const path = require('path')

// Response headers applied to every route. No CSP yet (follow-up): hydration needs inline
// scripts, and a nonce-free policy (`unsafe-inline`) would look like protection while providing none.
const securityHeaders = [
  // Prevents clickjacking — the dispatcher is never legitimately iframed.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Trip URLs carry ids; don't leak the full path to third parties.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Deny by default; only the driver PWA captures camera/mic/location.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the monorepo root so Next.js doesn't adopt an ancestor lockfile as its trace root.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: {
    externalDir: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
