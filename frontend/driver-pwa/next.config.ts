import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Required for output: 'export' — Next.js image optimisation uses a server; static export cannot.
  images: { unoptimized: true },
};

// Disable serwist in development — the SW would intercept hot-reload requests and break fast refresh.
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
});

export default withSerwist(nextConfig);
