const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Explicitly set the monorepo root so Next.js doesn't mis-detect it
  // from the stub package-lock.json at the repo root (added for Docker).
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: {
    externalDir: true,
  },
}

module.exports = nextConfig
