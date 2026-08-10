const path = require('path')

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Explicitly set the monorepo root so Next.js does not select an unrelated lockfile
  // from an ancestor directory.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  experimental: {
    externalDir: true,
  },
}

module.exports = nextConfig
