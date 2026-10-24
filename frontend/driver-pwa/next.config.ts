import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";
// Relative (not `@shared/*`) import — next.config.ts runs outside the app's path-alias
// resolution, and phase-meta.ts's own import is type-only, erased at transpile time.
import { STEP_SLUGS } from "../shared/lib/constants/phase-meta";
import { discoverStaticPageRoutes } from "./lib/precache/static-page-routes";

// `next build` always runs with NODE_ENV=production. With output: 'export' there's no
// server to read env vars at request time — NEXT_PUBLIC_API_URL is baked into the bundle
// at build time, so an unset/localhost value here means the shipped app silently talks
// to a backend that doesn't exist on the device. Set the real target before building.
if (process.env.NODE_ENV === "production") {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl || apiUrl.includes("localhost")) {
    throw new Error(
      "[next.config.ts] NEXT_PUBLIC_API_URL is unset or points at localhost for a " +
        "production build. Set it to the real backend origin (deployed URL, or a LAN IP " +
        "for a local cap:sync build) before building.",
    );
  }
  // Demo mode is on unless the variable is exactly "false", and it swaps in simulated sign-in
  // and evidence responses. A release built with the variable forgotten would look like it
  // works while recording nothing, so a production build has to state which one it is.
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE;
  if (demoMode !== "true" && demoMode !== "false") {
    throw new Error(
      "[next.config.ts] NEXT_PUBLIC_DEMO_MODE must be set to \"false\" (real backend) or " +
        "\"true\" (simulated demo build) for a production build.",
    );
  }
}

// Reused for the SW precache revision and the NEXT_PUBLIC_APP_VERSION injection. A
// deliberate version bump, not a build timestamp, so clients don't re-download every
// route entry on every deploy with no content change.
const { version: packageJsonVersion } = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"),
) as { version: string };

// Security headers (X-Frame-Options etc, set via headers() in the dispatcher) are
// deliberately NOT set here: `headers()` does nothing under output: 'export' — there's
// no server in the request path to emit them. They must come from the static host
// (Vercel/Netlify/nginx) for the browser PWA; the Android APK loads assets over
// capacitor://, where framing/referrer leakage don't apply the same way.
const nextConfig: NextConfig = {
  output: "export",
  // Pins the trace root to this monorepo, matching the dispatcher — otherwise Next can
  // adopt an ancestor directory's unrelated lockfile as the workspace root.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // Required for output: 'export' — Next.js image optimisation uses a server.
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJsonVersion,
  },
};

// @serwist/next's InjectManifest builds its precache manifest from webpack's emitted
// assets plus `additionalPrecacheEntries`, which REPLACES the default public/ scan.
// Webpack's assets exclude prerendered HTML, so every page is listed here explicitly.
// The static export (out/**) doesn't exist until after webpack compiles, so static
// routes are read from the app/ tree instead of a hand-kept list.
const STATIC_ROUTES = discoverStaticPageRoutes(path.join(__dirname, "app"));

const PHASE_ROUTES = (Object.keys(STEP_SLUGS) as (keyof typeof STEP_SLUGS)[]).flatMap((type) =>
  STEP_SLUGS[type].map((slug) => `/trip/phase/${type}/step/${slug}`),
);

// MOCK_TRIP_IDS mirrors frontend/shared/lib/mocks/trips.ts; drop it once trip detail is
// fetched by live id (a route keyed on live data can't be static-precached).
const MOCK_TRIP_IDS = [
  "7e8f9a0b-1c2d-4e3f-8a5b-6c7d8e9f0a1b",
  "8f9a0b1c-2d3e-4f4a-8b6c-7d8e9f0a1b2c",
  "9a0b1c2d-3e4f-4a5b-8c7d-8e9f0a1b2c3d",
  "0b1c2d3e-4f5a-4b6c-8d8e-9f0a1b2c3d4e",
  "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
  "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a",
  "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b",
];
const TRIP_DETAIL_ROUTES = MOCK_TRIP_IDS.map((id) => `/trips/${id}`);

const PRECACHED_ROUTES = [...STATIC_ROUTES, ...PHASE_ROUTES, ...TRIP_DETAIL_ROUTES];

// Each route precaches under its exact exported filename: `<route>.html` (full document,
// for hard navigation) and `<route>.txt` (RSC flight payload for soft navigation).
// Deliberately not the extension-less clean URL — an entry that 404s fails the entire SW
// install. Where hosting does clean-URL rewriting, an unvisited route falls through to
// the NetworkFirst handler in app/sw.ts instead of an instant precache hit.
function routeToPrecacheEntries(route: string): { url: string; revision: string }[] {
  const base = route === "/" ? "/index" : route;
  return [
    { url: `${base}.html`, revision: packageJsonVersion },
    { url: `${base}.txt`, revision: packageJsonVersion },
  ];
}

// additionalPrecacheEntries replaces the default public/ scan, so those files are
// re-added here, keyed by content hash so they only bust cache when bytes change.
function publicFilePrecacheEntry(relPath: string): { url: string; revision: string } {
  const contents = fs.readFileSync(path.join(process.cwd(), "public", relPath));
  const revision = crypto.createHash("sha256").update(contents).digest("hex").slice(0, 16);
  return { url: `/${relPath}`, revision };
}

const additionalPrecacheEntries = [
  ...PRECACHED_ROUTES.flatMap(routeToPrecacheEntries),
  publicFilePrecacheEntry("manifest.json"),
  publicFilePrecacheEntry("icons/icon-192.png"),
  publicFilePrecacheEntry("icons/icon-512.png"),
];

// Disable serwist in development — the SW would intercept hot-reload requests and break fast refresh.
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  additionalPrecacheEntries,
});

export default withSerwist(nextConfig);
