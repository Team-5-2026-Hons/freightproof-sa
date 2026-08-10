const path = require('path')

// Response headers applied to every route.
//
// The one that matters most here is X-Frame-Options: without it, any site can load the
// dispatcher board in an invisible iframe over its own UI and harvest clicks from a
// signed-in dispatcher — cancelling a trip or overriding a phase are one click each, and
// both are audit-visible actions attributed to that dispatcher.
//
// No Content-Security-Policy yet, deliberately rather than by oversight: Next's dev and
// build output uses inline scripts for hydration, so a useful CSP needs the nonce
// plumbing that goes with it. Adding a policy loose enough to work without that
// (`unsafe-inline`) would sit in the codebase looking like protection while providing
// none. Tracked as follow-up work, not silently dropped.
const securityHeaders = [
  // Refuse framing outright. The dispatcher is never legitimately embedded anywhere.
  { key: 'X-Frame-Options', value: 'DENY' },
  // Stop the browser second-guessing a declared Content-Type — the sniffing that turns
  // an uploaded file served as one type into script.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Send the origin, never the full path, to third parties. Trip URLs carry ids.
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // Nothing here uses the camera, microphone or geolocation — the dispatcher is a desk
  // surface, and the driver PWA is the one that captures. Deny by default so a
  // compromised dependency cannot quietly ask for them.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the monorepo root explicitly so Next.js never walks up and adopts an unrelated
  // lockfile from an ancestor directory as its trace root.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: {
    externalDir: true,
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

module.exports = nextConfig
