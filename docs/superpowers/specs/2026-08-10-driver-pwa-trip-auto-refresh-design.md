# Driver PWA — trip auto-refresh while waiting on the warehouse

**Date:** 2026-08-10
**Owner:** Tim (driver side)
**Surfaces:** `frontend/driver-pwa/` only. No backend change. No `frontend/shared/` change. No migration.

## Problem

On an iOS device (Capacitor WKWebView, served from the `capacitor://localhost` scheme),
a driver who reaches the loading phase sees "Waiting for the warehouse" and it never
clears. The only way past it is to kill the app and relaunch, which remounts
`TripProvider` and triggers its one-and-only fetch.

## Root cause

Confirmed by reading the code, not inferred:

1. `lib/context/TripContext.tsx` fetches the trip **once on mount** (the effect at the
   end of the provider). There is no polling, no stream, and no refetch-on-resume
   anywhere in the driver PWA. App relaunch is the only refresh path that exists.
2. The waiting card is `components/phase/steps/loading/Linehaul.tsx`, gated on
   `phase.blocked_on`.
3. `blocked_on` is derived **server-side, per request**, by
   `backend/app/orchestration/phase_gate.py:blocked_on_by_stop`, which reads the
   warehouse scan feed (`backend/app/integrations/scan_feed.py`).

### Two things ruled out

- **Service worker staleness.** `app/sw.ts` matches `/api/` with `NetworkOnly`, so no
  API response is ever served from cache. Not the cause.
- **The existing realtime bus.** `backend/app/core/realtime.py` publishes from a
  SQLAlchemy `after_commit` listener, and its SSE endpoint
  (`backend/app/api/v1/endpoints/stream.py`) authenticates with
  `get_current_dispatcher` and is org-scoped. The warehouse closing a scan session
  writes a **Redis key outside our database** — there is no FreightProof commit to
  hang a publish on. The bus cannot see this transition at all.

## Why the fix is client-side

`GET /trips/me/active` **already recomputes `blocked_on` on every read**. The backend is
correct as it stands; the client simply never asks again. `scan_feed.py` documents itself
as deliberately pull-shaped ("a real WMS integration would be polled exactly like PP is,
so a push interface would not survive the swap"), so a client poll is the design-consistent
answer rather than a workaround.

A driver-scoped SSE endpoint was considered and rejected: the scan-session close is an
external Redis write, so SSE would still need a server-side poller to detect it — polling,
merely relocated — plus a new auth surface on a shared endpoint.

## Decisions taken

| Decision | Choice |
|---|---|
| Scope | All gated waits (`LOADING`, `UNLOADING`, `CONFIRMATION` per `GATED_PHASES`) **and** `exception_hold` release |
| Mechanism | Quiet poll while blocked + unconditional refresh on app foreground |
| "Auto update" | Trip **data** only. No Capacitor live-reload, no bundle auto-update |

## The constraint that shapes the design

Six screens blank to a spinner when `TripContext.isLoading` is true:
`HomeContent.tsx`, `PhaseStepPageClient.tsx`, `InTransitPageClient.tsx`,
`PanicPageClient.tsx`, `ActiveTripPageClient.tsx`, `TripDetailByIdPageClient.tsx`.

`refetchTrip` sets `isLoading = true`. A naive `setInterval(refetchTrip)` would therefore
flash a spinner across the driver's screen every tick. **The refresh must not touch
`isLoading`.** This is why a new quiet path is added rather than reusing `refetchTrip`.

## Architecture

| File | Change |
|---|---|
| `lib/hooks/useTripAutoRefresh.ts` | **new** — pure timing/visibility hook. Owns the interval, the foreground listeners, the single-flight guard, the offline skip. Knows nothing about trips. |
| `lib/context/TripContext.tsx` | **modify** — add `refreshQuietly`, `isRefreshing`, `lastRefreshedAt`; call the hook once inside `TripProvider`; raise the unblock toast. |
| `lib/constants/app.ts` | **modify** — add `TRIP_POLL_INTERVAL_MS`. |
| `components/phase/steps/loading/Linehaul.tsx` | **modify** — waiting card gains a "checking…" indicator and a **Check now** button. |

`TripProvider` is mounted exactly once, in `app/(app)/layout.tsx`, wrapping every
authenticated route. Putting the refresh inside it guarantees one poller for the whole
app with no chance of two screens polling in parallel. It also sits inside the root
`ToastProvider`, so it can raise the unblock toast itself.

### API contract (pinned — implement exactly)

```ts
// lib/hooks/useTripAutoRefresh.ts
export interface TripAutoRefreshOptions {
  /** Run the periodic poll. The foreground refresh fires regardless of this flag. */
  pollingEnabled: boolean
  intervalMs: number
  /** Must never throw — the hook does not catch. */
  onRefresh: () => Promise<void>
}

export function useTripAutoRefresh(options: TripAutoRefreshOptions): void
```

```ts
// lib/context/TripContext.tsx — added to the existing TripState interface
export interface TripState {
  // ...existing members unchanged...

  /** Refetch the trip WITHOUT touching isLoading. Never throws. No-op in demo mode. */
  refreshQuietly: () => Promise<void>
  /** True while a quiet refresh is in flight. For honest "checking…" UI only. */
  isRefreshing: boolean
  /** ISO timestamp of the last successful quiet refresh, or null if none yet. */
  lastRefreshedAt: string | null
}
```

### Polling predicate

Derived in `TripProvider`. `actionablePhase` is already imported from `@/lib/phase/derive`
in this file's sibling modules, and `derive.ts` imports only `@shared` types, so there is
no circular-import risk.

```ts
const actionable = trip !== null ? actionablePhase(trip.phases) : null
const pollingEnabled =
  trip !== null &&
  ((actionable?.blocked_on ?? null) !== null || trip.status === 'exception_hold')
```

`?? null` first is mandatory — `blocked_on` is optional on the shared `PhaseDescriptor`
type, and `undefined !== null` would be permanently true. `Linehaul.tsx:41` already
carries this exact guard and comment; match it.

### Data flow

```
warehouse closes scan session
    ↓  Redis key written outside our DB — nothing is pushed, by design
interval tick (while blocked)  OR  app returns to foreground
    ↓  refreshQuietly() → GET /trips/me/active
backend recomputes blocked_on_by_stop from the scan feed
    ↓  setServerTrip(fresh)
phase.blocked_on becomes null → Linehaul re-renders actionable + unblock toast
```

## Required properties

These are what stop this from breaking the driver's evidence. Each is a test case.

1. **Quiet.** `refreshQuietly` never sets `isLoading`. None of the six screens above may
   flash a spinner on a poll.
2. **Optimistic layer preserved.** The refresh writes `serverTrip`;
   `withOptimisticResolution` re-layers `syncingPhaseIds` on top. A poll landing
   mid-submission must not un-complete a phase the driver has just swiped.
3. **Single-flight.** Overlapping ticks and foreground events collapse into one in-flight
   request.
4. **Narrowly enabled.** The interval runs only while `pollingEnabled`. An idle or driving
   trip issues zero extra requests — no all-day battery or data drain on a driver's phone.
5. **Offline-safe.** Skip the refresh when `navigator.onLine === false`. Failures are
   logged via `console.error` and swallowed — never surfaced as a toast, or a blocked
   driver with no signal gets one every 15 seconds.
6. **Bounded.** The interval is cleared on unmount and whenever `pollingEnabled` flips
   false. Listeners are removed on unmount.
7. **Demo mode inert.** `IS_DEMO_MODE` short-circuits `refreshQuietly` — there is no
   server to ask.
8. **Leading edge.** When `pollingEnabled` flips true, check *immediately*, then on the
   interval. Added after field testing (2026-08-10): the gate can close before the driver
   even walks up to the step, so the plan the screen first renders from is often already
   stale on arrival. A trailing-edge-only interval leaves that stale "Waiting for the
   warehouse" up for a full interval, which is indistinguishable from "this page never
   refreshes" to someone standing at a gate. Loop-safe: the effect is keyed on
   `pollingEnabled`, and a refresh that finds the phase still blocked leaves the flag true
   and the deps unchanged.

## iOS behaviour

`visibilitychange` fires in the Capacitor WKWebView when the app is backgrounded and
foregrounded, and iOS suspends JS timers while backgrounded — so the interval pauses on
its own and the foreground handler does the catch-up. `window.focus` is listened to as
well; the single-flight guard makes the overlap harmless.

`@capacitor/app` is deliberately **not** added. `visibilitychange` covers the case, and
adding the plugin would touch the shared `frontend/driver-pwa/package.json` and force a
`cap sync` plus an Xcode rebuild for no functional gain.

## Testing

Vitest (`npm run test` in `frontend/driver-pwa`). Follow the arrange/act/assert style and
fake-timer usage of `lib/hooks/__tests__/usePhaseDraft.test.ts`.

**`lib/hooks/__tests__/useTripAutoRefresh.test.ts`**
- polls at `intervalMs` while `pollingEnabled`
- issues no interval calls while `pollingEnabled` is false
- refreshes on `visibilitychange` → visible, even when `pollingEnabled` is false
- collapses concurrent invocations into one in-flight refresh
- skips the refresh when `navigator.onLine` is false
- clears the interval and removes listeners on unmount

**`lib/context/__tests__/TripContext.autorefresh.test.tsx`**
- `refreshQuietly` does not set `isLoading` at any point
- a refresh landing while a phase is in `syncingPhaseIds` leaves that phase resolved
- a rejected refresh is logged and does not throw or clear the trip

**`components/phase/steps/__tests__/linehaul.test.tsx`** (extend the existing file)
- the blocked state renders a **Check now** control
- activating it calls `refreshQuietly`

**`app/(app)/trip/phase/[type]/step/[slug]/__tests__/PhaseStepPageClient.autorefresh.test.tsx`**

The one test the other three page-client suites cannot be. All of them
`vi.mock('@/lib/hooks/useTrip')` and hand the page a hand-built trip, so none of them
exercises the real chain from a poll landing in `TripContext` through to what the driver is
looking at — which is exactly the class of bug ("the context went fresh and the page kept
rendering the stale plan") that the 2026-08-10 field report pointed at. This file mounts
the **real** `TripProvider` and mocks only the API boundary:

- a driver standing on the blocked loading step, touching nothing, sees the wait card clear
  one poll interval after the warehouse closes its session
- arriving at an already-stale blocked step clears it immediately, not an interval later
  (property 8)

No `pytest` changes — the backend diff is empty.

## Out of scope — flagged, not silently done

- `Linehaul.tsx` is the **only** step screen with waiting copy. Whether the unloading and
  confirmation gates render a waiting state at all is a separate UI gap. Audited and
  reported under this spec; **not** fixed here without Tim's approval.
- `@capacitor/app`, Capacitor live-reload, driver SSE endpoint — all rejected above.
- No `frontend/shared/` file is touched (read-only for this owner).
- No shared backend file, no `config.py`, no `.env` key, no migration.

## Execution

Two agents, dispatched in parallel:

- **Agent A (executor):** the whole mechanism — `useTripAutoRefresh.ts`,
  `TripContext.tsx`, `app.ts`, `Linehaul.tsx`, and all three test files. The UI change
  ships with the API it consumes so the diff can actually be type-checked as a unit.
- **Agent B (read-only audit):** report missing waiting states on the unloading and
  confirmation step screens. Reports only, changes nothing.

Verification gate before this is called done, run from `frontend/driver-pwa`:

```
npm run type-check && npm run test && npm run lint
```

`npm run lint` has **pre-existing, unrelated** failures in `app/global-error.tsx`
(`@next/next/no-html-link-for-pages`) and `lib/context/AuthContext.tsx` (a stale
`react-hooks/set-state-in-effect` disable comment) — both documented in `next.config.ts`
and owned by other in-progress work. Lint must be clean **for the files this change
touches**; do not fix those two, and do not treat them as a failure of this work.
