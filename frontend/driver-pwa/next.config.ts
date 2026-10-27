import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";
import { STEP_SLUGS } from "../shared/lib/constants/phase-meta";
import { discoverStaticPageRoutes } from "./lib/precache/static-page-routes";

if (process.env.NODE_ENV === "production") {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  if (!apiUrl || apiUrl.includes("localhost")) {
    throw new Error(
      "[next.config.ts] NEXT_PUBLIC_API_URL is unset or points at localhost for a " +
        "production build. Set it to the real backend origin (deployed URL, or a LAN IP " +
        "for a local cap:sync build) before building.",
    );
  }
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE;
  if (demoMode !== "true" && demoMode !== "false") {
    throw new Error(
      "[next.config.ts] NEXT_PUBLIC_DEMO_MODE must be set to \"false\" (real backend) or " +
        "\"true\" (simulated demo build) for a production build.",
    );
  }
}

const { version: packageJsonVersion } = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"),
) as { version: string };

const nextConfig: NextConfig = {
  output: "export",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  images: { unoptimized: true },
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJsonVersion,
  },
};

const STATIC_ROUTES = discoverStaticPageRoutes(path.join(__dirname, "app"));

const PHASE_ROUTES = (Object.keys(STEP_SLUGS) as (keyof typeof STEP_SLUGS)[]).flatMap((type) =>
  STEP_SLUGS[type].map((slug) => `/trip/phase/${type}/step/${slug}`),
);

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

function routeToPrecacheEntries(route: string): { url: string; revision: string }[] {
  const base = route === "/" ? "/index" : route;
  return [
    { url: `${base}.html`, revision: packageJsonVersion },
    { url: `${base}.txt`, revision: packageJsonVersion },
  ];
}

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

const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  additionalPrecacheEntries,
});

export default withSerwist(nextConfig);
