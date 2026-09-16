import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, NetworkOnly, Serwist } from "serwist";

// @serwist/next injects the build-time precache manifest into __SW_MANIFEST.
declare global {
  interface ServiceWorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Named separately from Serwist's own precache/runtime caches so it can be identified
// and cleared independently (DevTools > Application > Cache Storage).
const PAGES_CACHE_NAME = "fp-driver-pages";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    // Evidence platform: a stale cached API response (trip status, handshake state, anchor
    // receipts) is actively dangerous. NetworkOnly makes "never cache this" explicit.
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    // Full-page navigations not covered by the precache fall back to network-first, so a
    // driver only ever sees the last-cached shell when the network is unreachable.
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: PAGES_CACHE_NAME,
        networkTimeoutSeconds: 4,
      }),
    },
  ],
});

serwist.addEventListeners();
