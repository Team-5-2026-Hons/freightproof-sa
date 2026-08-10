import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { NetworkFirst, NetworkOnly, Serwist } from "serwist";

// @serwist/next injects the build-time precache manifest into __SW_MANIFEST.
declare global {
  interface ServiceWorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Separate, named cache for page navigations — kept distinct from Serwist's own
// precache/runtime cache names so it's identifiable in DevTools > Application > Cache
// Storage, and so clearing it (e.g. during a future cache-versioning bump) doesn't touch
// the precache.
const PAGES_CACHE_NAME = "fp-driver-pages";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: [
    // This is an evidence platform — a stale cached API response (trip status, handshake
    // state, anchor receipts) is actively dangerous, not just inconvenient. Every route in
    // next.config.ts's precache list is matched and served *before* these runtime routes
    // ever run (Serwist checks precache first), so this only ever sees requests that
    // aren't one of our own static assets — i.e. exactly the backend calls made through
    // lib/api/client.ts (`${BASE_URL}/api/v1/...`). NetworkOnly (rather than simply
    // omitting a rule) makes "never cache this" an explicit, reviewable decision instead
    // of an accidental gap.
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    // Full-page navigations (cold start, hard refresh, a deep link) that aren't an exact
    // match for one of the precached route entries above — e.g. a trip/handshake route
    // whose static params list has drifted from next.config.ts's hand-maintained copy —
    // fall back to network-first: fetch fresh when online (a driver mid-handshake should
    // never see stale UI), and only serve the last-cached page shell for that URL when
    // the network is unreachable. A driver who has visited a route at least once while
    // online will find it here when offline later; a route visited for the first time
    // while already offline still fails, same as today, since there is nothing to have
    // cached yet.
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
