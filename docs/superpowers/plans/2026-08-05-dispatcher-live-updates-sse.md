# Dispatcher Live Updates — Server-Sent Events over an org-wide event bus

> Self-contained feature plan. The design (what & why) is up top so the approach is
> defensible at examination; the phased task list (how) is below and is what you execute from.
>
> **Created:** 2026-08-05 · **Owner:** Tom · **Branch:** `Tom`
> **Depends on Ciaran:** yes — phase-refactor merged into `Tom` on 2026-08-05 (fast-forward to `4e4cf93`). Prerequisite cleared.
> **Blocks driver app:** no (dispatcher-side only; the bus is reusable by the driver PWA later).
> **Status:** ready to execute — Stage 0 complete (§5), baseline re-measured against `4e4cf93` (§7).

---

## 1. Goal

The dispatcher portal must reflect what the driver is doing **live**, without a page refresh.
When the driver activates a trip, completes a phase, or raises an exception on their phone, the
dispatcher's screen updates on its own — phase nodes tick over, exceptions pop up, receipts appear.
Today every dispatcher screen is a **one-shot fetch**: `useTripDetail` → `useAsyncData` →
`api.get('/api/v1/trips/{id}')` runs once on mount, so new data only lands on a manual reload.

The fix is a **shared, org-wide live channel** that every dispatcher screen plugs into — not a
bolt-on wired to a single page. That framing is deliberate (§3, D3): it is the difference between
"the trip page is live" and "the system is live".

## 2. Decisions (locked during brainstorming, 2026-08-05)

| # | Decision | Why |
|---|---|---|
| D1 | **Transport = Server-Sent Events (SSE)**, not WebSocket, not Supabase Realtime, not polling. | The dispatcher only ever *receives*; it never pushes over the live channel. SSE is one-directional server→client, auto-reconnects, runs over plain HTTP, and needs far less code and fewer failure modes than WebSocket. |
| D2 | **Thin pings, not data payloads.** The stream carries only `{resource, id, kind, ts}` — never trip data. The browser reacts by re-calling the authorized `GET /trips/{id}` it already uses. | Zero new PII surface: no GPS/photos/parcel data crosses the live channel. The POPIA story stays **identical to today** — the browser re-reads through the same door it is already allowed through. |
| D3 | **One org-wide channel, one connection per dispatcher** — publish to `org:{organization_id}`, not `trip:{id}`. | This is what makes it a system capability, not a trip-page feature. One SSE connection per browser carries every change the dispatcher is entitled to; each screen filters the stream for what it cares about. New screens subscribe to the same bus with no new plumbing. |
| D4 | **Reuse the existing auth gate; add no RLS.** The SSE endpoint is guarded by `get_current_dispatcher`; the dispatcher's org comes from the authenticated JWT. | Rejecting Supabase Realtime avoids standing up a *second* authorization model (row-level security) that would have to be proven airtight for POPIA. The backend stays the single bouncer. |
| D5 | **Redis Pub/Sub for fan-out** (`redis==5.0.4`, already the Celery broker; use `redis.asyncio`). | Multi-worker correctness: the uvicorn worker holding a dispatcher's SSE connection must receive an event published by whichever worker handled the driver's POST. In-process events cannot cross workers; Redis Pub/Sub does. **No new dependency.** |
| D6 | **Plain Starlette `StreamingResponse`, no `sse-starlette`.** | Smallest blast radius — `requirements.txt` stays untouched, nothing new for the team to install. Starlette alone does the whole job; the library would only save a few lines of heartbeat/disconnect boilerplate. |
| D7 | **Reconnect always triggers a fresh refetch.** No event replay / Last-Event-ID buffer in v1. | A dropped connection may miss pings, but on reconnect the browser refetches the current truth from the GET, so no state is permanently "lost". Simpler and correct; event replay is unnecessary complexity here. |
| D8 | **GPS / checkpoint streaming is deferred** (see §8, Future extensions). | In-transit produces frequent GPS checkpoints — real volume cost. v1 carries the "what is the driver doing" signal (phase / exception / trip lifecycle). The bus is designed so GPS is an additive `kind`, not a redesign. |
| D9 | **Publish after commit, via a per-request outbox drained by a SQLAlchemy `after_commit` hook** — not a bare `publish_event` inside the service. (Discovered at Stage 0, see §4.3.) | The service layer only `flush()`es; `get_db` commits at the request boundary *after* the endpoint returns (`db/session.py:44`). A ping fired inside the service would race the dispatcher's refetch against an **uncommitted** transaction and could read stale data. Publishing on `after_commit` guarantees the browser only ever refetches committed truth, and a rollback publishes nothing. It also respects the layering law — `db/session.py` must not import `core/`, so the drain is triggered by a SQLAlchemy event registered from `core/realtime.py`, not by editing `get_db`. |

## 3. Why this works with the current setup (no schema change, no new dependency)

- **Redis is already here.** `redis==5.0.4` is in `backend/requirements.txt:18` (the Celery broker),
  and `REDIS_URL` is already a settings field (`backend/app/core/config.py:28`). Its bundled
  `redis.asyncio` client gives us async Pub/Sub with nothing new to install.
- **Auth is already here.** The dispatcher holds a live Supabase session; the api client caches the
  access token (`frontend/dispatcher/lib/supabase/client.ts` → `getAccessToken()`) and
  `get_current_dispatcher` (`backend/app/auth/dependencies.py`) already verifies dispatcher JWTs and
  exposes `organization_id`. The SSE endpoint reuses both — no new auth code, no new token type.
- **The read path is already here.** Every screen already fetches through the typed api client
  (`frontend/dispatcher/lib/api/client.ts`) and `useAsyncData`, which exposes `refetchSilent()` —
  a refetch that updates in place with **no loading spinner**. The live layer's only job is to call
  `refetchSilent()` at the right moment. Nothing about the existing fetch/render path changes.
- **No DB schema change, no Alembic migration, no RLS, no `.env` key.** The heartbeat interval and
  channel prefix are module constants, not settings — `config.py` (a shared file) stays untouched.

## 4. Design

### 4.1 The event bus (`backend/app/core/realtime.py`, new)

A small, generic module. Deliberately not trip-specific.

- `TripEvent` — a Pydantic v2 model: `resource: Literal["trip"]`, `id: UUID`, `kind: RealtimeKind`,
  `ts: datetime`. `RealtimeKind` is a `str, Enum`: `trip_created`, `phase_completed`,
  `exception_raised`, `trip_closed`. (Room for `checkpoint_logged` later — D8.)
- `async def publish_event(org_id: UUID, event: TripEvent) -> None` — serialise to JSON, `PUBLISH`
  to channel `org:{org_id}` via a shared `redis.asyncio` client.
- `async def subscribe(org_id: UUID) -> AsyncIterator[TripEvent]` — an async generator that
  `SUBSCRIBE`s to `org:{org_id}` and yields parsed events; cleans up the subscription on close.
- `def enqueue_event(session: AsyncSession, org_id: UUID, event: TripEvent) -> None` — the **only**
  call sites the orchestration layer touches. Appends to a per-request outbox on
  `session.info["realtime_outbox"]`. Publishes nothing itself (see D9).
- `register_realtime_hook()` — called once at app startup; registers a SQLAlchemy `after_commit`
  listener on the async session's underlying sync session. On commit it drains the outbox and
  schedules each `publish_event` on the running event loop (async publish from a sync event
  handler); on rollback the outbox is discarded, so nothing is published.
- One module-level connection pool; a `CHANNEL_PREFIX = "org:"` constant; a
  `HEARTBEAT_SECONDS = 15` constant lives in the endpoint module (§4.2), not here.

**Layering fence (drove the D9 design):** `core/realtime.py` may import `redis.asyncio`, `config`,
`db/session` (to attach the listener), and schemas — never `api/` or `orchestration/`. The direction
that is forbidden is `db/session.py` importing `core/`, which is exactly why the drain is a
registered event listener rather than a line inside `get_db`. Orchestration imports *this module*'s
`enqueue_event` only — one direction.

### 4.2 The SSE endpoint (`backend/app/api/v1/endpoints/stream.py`, new)

```
GET /api/v1/stream          →  text/event-stream, guarded by get_current_dispatcher
```

- Org is taken from `current_user.organization_id` — **the dispatcher can only ever receive their
  own org's events. This is the security boundary (D4); there is nothing to configure in the DB.**
- Returns a Starlette `StreamingResponse` whose async generator:
  1. emits an initial `: connected` comment so the client knows the stream is open,
  2. iterates `subscribe(org_id)`, formatting each event as an SSE `data:` frame,
  3. emits a `: heartbeat` comment every `HEARTBEAT_SECONDS` to keep proxies from closing an idle
     connection, and
  4. exits cleanly when the client disconnects (Starlette raises on the closed connection).
- Registered in `backend/app/main.py` (**shared file — flagged, §9**), one `include_router` line.

### 4.3 Emitting events (additive edits in `orchestration/`)

One `enqueue_event(session, org_id, event)` call per write path — **just enqueues** onto the
per-request outbox; the `after_commit` hook (§4.1, D9) does the actual publish once the transaction
commits. Additive only — no existing logic changes, no return values change.

Reading the merged code (`4e4cf93`) collapsed the emit surface from four scattered edits to **three
insertion points**, because all phase completions funnel through one helper and trip-close is a
side effect of a completion:

| Service (Ciaran's area) | Where | `kind` | org source |
|---|---|---|---|
| `phase_service.py` → `_finish_phase` (line ~279) | the single funnel every phase completion routes through | `phase_completed`, or `trip_closed` when that completion set `trip.status == CLOSED` (`phase_service.py:235`) | `trip.operator_organization_id` |
| `trip_service.py` → `create_trip` (line ~171) | after the CREATED trip + P0 are written | `trip_created` | `current_user.organization_id` (== the trip's `operator_organization_id`) |
| `exception_service.py` → `raise_exception` | after the exception row is written | `exception_raised` | `trip.operator_organization_id` |

Note the field name: trips key on **`operator_organization_id`** (not `organization_id`) — a
phase-refactor rename confirmed at Stage 0. `_finish_phase` already has `trip` in scope, so both the
org id and the post-completion `trip.status` (for the `trip_closed` vs `phase_completed` choice) are
free to read.

**Fail-open fence:** enqueuing must never break the driver's write, and neither must the later
publish. `enqueue_event` only appends to a list (cannot fail meaningfully); the `after_commit` hook
wraps each publish so a Redis hiccup is logged and swallowed — the commit already succeeded and is
the source of truth, and the dispatcher's reconnect-refetch (D7) catches up regardless.

### 4.4 The frontend live layer (`frontend/dispatcher/lib/realtime/`, new)

- **`types.ts`** — the `RealtimeEvent` shape mirroring the backend model.
- **`RealtimeProvider.tsx`** — mounted once in the dispatcher app shell (inside `AuthProvider`, so it
  has a token). Opens **one** SSE connection to `/api/v1/stream` using a fetch-based reader
  (`fetch` + `ReadableStream`, **not** the native `EventSource`) so it can send the
  `Authorization: Bearer` header from `getAccessToken()` — native `EventSource` cannot set headers.
  Handles: auto-reconnect with capped backoff, pause on `document.hidden` and resume + refetch on
  visibility, and a connection state (`live | reconnecting | offline`). Fans events out to
  subscribers via a small in-memory emitter.
- **`useLiveResource.ts`** — `useLiveResource(resource, id | 'any', onEvent)`; the subscribe helper
  every screen uses. Trip detail passes its `tripId`; the list passes `'any'`.
- **`LiveBadge`** — a small "● Live / Reconnecting" indicator in the shell top bar.

### 4.5 Wiring the consumers (edits)

| File | Change |
|---|---|
| `lib/hooks/useTripDetail.ts` | subscribe via `useLiveResource('trip', tripId, …)`; on a matching event, call the underlying `refetchSilent()`. |
| `lib/hooks/useTrips.ts` | subscribe with `'any'`; on any `trip` event, `refetchSilent()` so status chips + `open_exception_count` update. |
| shell layout | mount `RealtimeProvider` + `LiveBadge`. |
| exception handling | on `kind === 'exception_raised'`, fire a `ToastContext` pop-up globally from the provider. |

### 4.6 Out of scope

- **Driver PWA live updates** — the driver drives its own phases and has no consumer today. The bus
  is reusable there later with no redesign.
- **The standalone exceptions page** (`lib/hooks/useExceptions.ts`) — still on `mockExceptions`; a
  separate ticket. The live exception signal that matters rides on trip detail + the list.
- **GPS / checkpoint streaming** — deferred (D8, §8).
- **Event replay / Last-Event-ID buffering** — deferred (D7); reconnect-refetch covers it.

---

## 5. Implementation tasks (6 stages, each ~one work session)

### Stage 0 — Coordinate & re-baseline (no code) ✅ complete 2026-08-05
- [x] Ciaran's phase-refactor merged into `Tom` — clean fast-forward `eec1970 → 4e4cf93`, no
      conflicts, **no Alembic migration** in the incoming commit.
- [x] §7 baseline re-measured against `4e4cf93` (below): no stream endpoint yet, `redis==5.0.4`
      present, `REDIS_URL` set, `redis.asyncio` unused, `main.py` untouched.
- [x] Emit surface re-verified against the merged code — **three insertion points** confirmed
      (§4.3), the `_finish_phase` funnel and the `operator_organization_id` rename recorded.
- [x] Commit semantics re-verified — `get_db` commits at the request boundary, driving the D9
      after-commit-outbox design.
- [ ] Final: give Ciaran this updated plan to eyeball the three orchestration insertion points
      before Stage 3 edits his files.

### Stage 1 — Event bus
- [ ] `core/realtime.py`: `TripEvent`, `RealtimeKind`, `publish_event`, `subscribe`, `enqueue_event`,
      `register_realtime_hook` (the `after_commit` listener), shared client.
- [ ] Register `register_realtime_hook()` at app startup.
- [ ] Unit tests: publish→subscribe roundtrip; event JSON (de)serialisation; org isolation at the
      channel level; **outbox drains on commit and is discarded on rollback**.

### Stage 2 — SSE endpoint
- [ ] `endpoints/stream.py`: `GET /api/v1/stream`, `get_current_dispatcher`-guarded, heartbeat,
      clean disconnect. Register in `main.py`.
- [ ] Integration tests: 200 + a published event is delivered; 401 (no token); 403 (driver token);
      **org isolation** — a dispatcher in org A never receives an org-B event.

### Stage 3 — Emit events
- [ ] Additive `enqueue_event(...)` at the three §4.3 points: `_finish_phase` (phase_service),
      `create_trip` (trip_service), `raise_exception` (exception_service).
- [ ] `_finish_phase` chooses `trip_closed` vs `phase_completed` from the post-completion
      `trip.status`.
- [ ] Integration tests: completing a phase publishes exactly one event for the right org; the
      final completion publishes `trip_closed`; a rolled-back request publishes nothing.

### Stage 4 — Frontend connection layer
- [ ] `lib/realtime/` : `types.ts`, `RealtimeProvider.tsx`, `useLiveResource.ts`, `LiveBadge`.
- [ ] Mount `RealtimeProvider` in the shell; reconnect/backoff + tab-visibility handling.
- [ ] Unit test: the event filter/dispatch reducer (which subscribers fire for which events).

### Stage 5 — Wire the consumers
- [ ] `useTripDetail` and `useTrips` refetch silently on relevant events.
- [ ] `exception_raised` → global toast.

### Stage 6 — Hardening & demo
- [ ] Reconnect-after-offline restores live updates and refetches once on resume.
- [ ] Two-browser manual smoke: driver acts on the PWA → dispatcher screen moves with no reload.

---

## 6. Final verification (run once, at the end)

```
cd backend && pytest
cd frontend/dispatcher && npm run lint && npx tsc --noEmit
```

Manual smoke (two browsers): open a trip in the dispatcher; on the driver PWA, activate the trip,
complete a phase, and raise an exception. The dispatcher's timeline node ticks over, the exception
toast appears, and the active-trips list updates — **all without a reload**. Kill the network on the
dispatcher briefly; on restore, the "● Live" badge returns and the screen reconciles.

## 7. Verified baseline (measured 2026-08-05 on `Tom` @ `4e4cf93`, post-merge — not estimated)

| Fact | Real result |
|---|---|
| SSE / streaming endpoint anywhere | **none** (`grep text/event-stream\|StreamingResponse\|/api/v1/stream` → nothing) |
| `redis` dependency | present — `redis==5.0.4` (`requirements.txt:18`) |
| `REDIS_URL` setting | present (`config.py:28`) |
| `redis.asyncio` used anywhere | **not yet** — this feature introduces the first use |
| Dispatcher read path | one-shot `api.get` via `useAsyncData`; `refetchSilent()` already exists; `trips/[id]/page.tsx:241` still uses `useTripDetail` after the merge |
| Commit semantics | `get_db` commits at the request boundary (`db/session.py:44`); services `flush()` only → drives D9 |
| Phase completion funnel | all completions route through `_finish_phase` (`phase_service.py:279`); trip-close is set inside a completion (`phase_service.py:235`) |
| Trip org field | **`operator_organization_id`** (phase-refactor rename), not `organization_id` |
| Incoming merge migrations | **none** — no Alembic conflict |
| Our clean targets after merge | `main.py`, `exception_service.py`, `useTripDetail`, `useTrips`, `useAsyncData`, api client, supabase client — all untouched by `4e4cf93` |

## 8. Future extensions (documented, not built)

- **GPS / checkpoint streaming (D8).** Add `checkpoint_logged` to `RealtimeKind`, publish from
  `checkpoint_service`, and have an in-transit map/timeline subscribe. Watch volume: consider
  throttling/coalescing high-frequency GPS pings before they hit the bus. No redesign needed — this
  is an additive `kind` and one more consumer.
- **Driver PWA as a second consumer** of the same bus, if a live dispatcher→driver signal is ever
  wanted (e.g. dispatcher-acknowledged exceptions).
- **Event replay** via Last-Event-ID + a short Redis Stream buffer, if reconnect-refetch (D7) ever
  proves insufficient at scale.

## 9. Shared files touched (flag in TASK COMPLETE / PR)

`backend/app/main.py` (one `include_router` line + a `register_realtime_hook()` startup call —
shared). Orchestration services (`trip_service.py`, `phase_service.py`, `exception_service.py`) are
**Ciaran's area** — additive `enqueue_event` edits, coordinate per Stage 0. **`db/session.py` is
deliberately NOT edited** — the after-commit drain is a registered SQLAlchemy listener, which is what
keeps `db/` from importing `core/` (D9). **No migration. No `.env` keys. `config.py` untouched.**

## 10. Invariants — must not break

- **Layering:** endpoints → orchestration → integrations/blockchain/crypto → db. `db/` must not
  import `core/` — which is why the after-commit publish is a registered SQLAlchemy listener, not a
  line in `get_db` (D9). Orchestration imports `core.realtime.enqueue_event` only.
- **Publish only committed truth:** the stream is fired from `after_commit`; a rolled-back
  transaction publishes nothing, so the dispatcher never refetches on a change that didn't happen.
- **POPIA:** no personal data on the live channel — pings carry ids + a `kind`, never trip data. Only
  hashes still reach Hedera; this feature adds nothing to that path.
- **Single auth gate:** the backend remains the only authorization boundary; no RLS is introduced.
- **The ledger is the truth:** the stream never carries state the browser then trusts — it triggers a
  refetch of the authoritative GET. A missed ping self-heals on reconnect.
- **Fail-open on publish:** a Redis failure never breaks the driver's write; the commit already won.
- **Never run git write commands.** Suggest commits; the developer runs them.

## 11. Suggested commits (you run git; not me)

- `feat(realtime): org-scoped Redis pub/sub event bus + TripEvent model`
- `feat(api): SSE /stream endpoint, dispatcher-guarded, org-isolated`
- `feat(orchestration): publish live events on phase/exception/trip lifecycle`
- `feat(dispatcher): RealtimeProvider, useLiveResource, live badge + toast wiring`
- `test(realtime,stream): pub/sub unit + SSE integration incl. org isolation`
