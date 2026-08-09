# Phase Model Refactor — Parent Plan (Scope B)

**Created:** 2026-07-25 · **Verified:** 2026-07-26 · **Decisions locked:** 2026-07-27
**Author:** Ciaran (drafted with Claude) · **Status:** ✅ **READY TO EXECUTE — Stage 0 starts now.**

> **What this document is.** The parent plan: architecture, locked decisions, ownership, invariants,
> stage objectives, and risks. It holds the *why*, and it is the artifact to defend at examination.
>
> **What this document is not.** A task list. Each stage gets its own detailed implementation plan
> (`…-stage-N-<name>.md`) written **one stage ahead**, just-in-time, using the template in §11.
> Writing all six now guarantees rewriting them — Stage 2's real shape depends on what Stage 1
> actually produced.

---

## HANDOFF BLOCK — paste this first in any fresh session

**What this is.** FreightProof's custody lifecycle is being refactored from a hard-wired 6-step
"Handshake" model (H0–H5, where `TripStatus` doubles as the state machine) into a **plan-driven
"Phase" model** (P0–P6, where the phase order is *data* generated at trip creation and the trip's
position is *derived* from a phase-event ledger). This is Scope B from
`docs/superpowers/specs/2026-07-23-phase-model-redesign-design.md` — the version that proves the
multi-stop, cross-dock feasibility thesis, not a cosmetic rename.

**Why plan-driven (decided; do not relitigate).** A cosmetic H→P rename proves nothing new. The
prototype's whole point is tamper-evident custody across a *real multi-stop network*. Only a
plan-driven ledger demonstrates that. Team position confirmed 2026-07-27: **do Scope B now** — a
correct base to build on beats patching a wrong shape later. Rejected alternatives in §4.

**Ownership.** Ciaran: backend, FastAPI, dispatcher, and the shared TypeScript contract. Tim:
driver-pwa, built against the frozen contract. **Ciaran starts first and clears the blockers; Tim
starts at the Stage-0 gate** (§6).

**Baseline (verified against `dev @ 802215a`).** ruff clean · mypy clean (152 files) · pytest
187 passed / **133 skipped**. Migration head `tim_add_exception_gps`, linear, single-headed.

**The one thing to internalise.** The ledger is the truth; the phase label is a view of it. Nothing
in this refactor may store "where the trip is" as an authoritative fact. It is derived, always.

---

## 0. Preconditions & verified baseline

### 0.1 Branch state (verified 2026-07-26, unchanged 2026-07-27)
- Work branch `Phase-refactor`, clean tree, sitting **exactly on `origin/dev` @ `802215a`**.
- `feature/trip-creation-redesign` (P0 trip creation redesign) — **merged**.
- `feature/gps-warehouse-geofencing` (Tim) — **merged**, PR #31, `aedfccf`, 2026-07-25,
  184 files / +8,249 / −1,295. The collision risk that dominated the original draft is gone.
- **Migration head: `tim_add_exception_gps`.** Chain is linear and single-headed
  (`0001 → … → ciaran_add_exception_scoping → 2026_07_14_ciaran_tcr → tim_add_exception_gps`).
  Chain the phase migration directly after it.

### 0.2 ⚠️ `main` does not contain Tim's GPS work — `dev` does
`origin/revert-27-feature/gps-warehouse-geofencing` (`d95d772`) reverted PR #27, and **that revert
is contained in `origin/main`**. Tim's work then re-landed on `dev` via PR #31. `main` and `dev`
have genuinely divergent histories over the same files this refactor rewrites. dev is our developement main branch.

**Consequence:** the eventual `dev → main` promotion will land on a branch where those files were
reverted. That merge will conflict, and a wrong resolution silently re-reverts Tim's GPS work
underneath the phase model. **Owner + date needed** — resolve the divergence as a separate,
deliberate merge *before* this refactor promotes. Do not discover it at presentation time.

### 0.3 The real gate: the test suite does not exercise the refactor surface
`tests/conftest.py` skips every DB fixture unless `TEST_DATABASE_URL` is set. Today:

| Suite | Passing | Skipped |
|---|---|---|
| `tests/unit/test_handshake_service.py` | payload-shape tests only | **all state-machine tests** |
| `tests/unit/test_verification_service.py` | — | **all** |
| `tests/integration/` (27 files) | — | **all** |
| **Whole suite** | 187 | **133 (41%)** |

`TEST_DATABASE_URL` is in **neither `.env.example` nor `.github/workflows/ci.yml`**, so no dev and no
CI run has ever executed them. This refactor rewrites `advance_h1..h5`; the only tests that would
catch a regression are the ones that don't run. **Stage 0.1 fixes this before anything else.**

**CI's real gates:** `ruff check .`, `mypy .`, then `pytest -m "not slow"` (no `slow` markers exist,
so that's the full suite). Both linters have actually blocked merges (`52ddb3b`, `fa60fe5`). Every
stage gate must run all three.

**`frontend/driver-pwa` has no CI job.** CI's `frontend` job covers only `frontend/dispatcher`
(lint + `tsc --noEmit`). The driver-pwa already has `lint`, `type-check`, and `test` (vitest)
scripts — CI simply never calls them. Stage 5 touches 61 source files with no automated net.

---

## 1. Locked decisions (2026-07-27)

These were the forks that blocked execution. All are now closed. **An executing agent must treat
these as settled and must not re-derive them.**

### D1 — Rename the table, don't create a new one
`handshake_events` → `phase_events` via `ALTER TABLE … RENAME`.
**Why:** the rename carries the RLS policies, indexes, and five inbound FKs across automatically,
and preserves the `evidence_artifacts` circular-FK `use_alter` arrangement that the initial
migration works hard to get right. A fresh table means re-creating all of it by hand, and the RLS
half fails silently (§5).

### D2 — P4 (In Transit) gets a real ledger row
In-Transit is a `PhaseEvent` row that points at checkpoint Merkle batches — not a derived label.
**Why:** "the ledger is the complete story" must stay literally true. A label-only P4 leaves a hole
in the ledger at exactly the longest, highest-risk part of the trip, and the plan generator would
have no answer for how many rows to emit.

### D3 — P4 anchors to the stop it departs from
`trip_stop_id` is **NULL only for P0**. Every other phase, including P4, is anchored to a stop:
P4-at-stop-1 means "the transit leg leaving stop 1".
**Why this matters more than it looks:** PostgreSQL treats NULLs as distinct in unique constraints,
so `UNIQUE(trip_id, trip_stop_id, phase_type)` would *not* prevent duplicate NULL-stop rows. Anchoring
P4 to its departure stop means only P0 is ever NULL, and one partial unique index closes it:
```sql
UNIQUE (trip_id, trip_stop_id, phase_type)                          -- P1..P6
CREATE UNIQUE INDEX uq_phase_events_trip_creation
  ON phase_events (trip_id) WHERE phase_type = 'trip_creation';     -- P0
```

### D4 — Anchor state is an enum column on `phase_events`
`anchor_status`: `not_required` | `pending` | `anchored` | `failed`.
**Why:** a separate anchor-attempt table is more correct and more than this prototype needs. The
column is the minimum that makes fail-open honest — a phase can be `completed` while its anchor is
`failed`, and the system still knows a receipt is owed.

### D5 — `PhaseType` values
```
trip_creation · activation · loading · departure · in_transit · unloading · confirmation
```

### D6 — Denormalization shape
`Trip.current_phase` = the phase-type string · `Trip.current_stop` = the stop's `sequence` int.
Both are **caches, never sources of truth** — rebuilt from the ledger on every completion. Any read
path may use them for lists and filters; no write path may branch on them.

### D7 — Anchors move with the evidence: one at origin, one at delivery
| Phase | Receipt | Policy |
|---|---|---|
| P0 trip_creation | `JOURNEY_LOCK` | **fail-closed** |
| P3 departure | `PICKUP` | fail-open |
| P6 confirmation | `DELIVERY` | fail-open |
| P1, P2, P4, P5 | none (feeders) | `not_required` |

**Why PICKUP moves from P2 to P3:** today H2 anchors `{seal_number, driver_visual_count}`. After the
refactor P2 is system-observed (no driver input) and the driver's count is removed entirely (F1) —
so a P2 payload would have nothing driver-attested left in it. The seal is captured at P3, so the
origin anchor belongs at P3. Net anchor count is unchanged from today: two per trip.

### D8 — Scope B now, confirmed
Team position 2026-07-27. The spec suggested Scope A first; we are deliberately going further to get
correct logic as the base rather than patching toward it.

### D9 — Shared-file ownership
`shared/lib/types/phase.ts` and `shared/lib/constants/phase-meta.ts` are **Ciaran-only until the
Stage-0 contract freeze ships**. After that Tim may adjust or fix them, but **must notify Ciaran**
on any change. Precedent for the rule: Tim's PR #31 already modified
`shared/lib/constants/handshake-meta.ts`, so this boundary has been crossed once already.

---

## 2. How the phase model actually works

This section is the mental model. If a stage plan and this section disagree, this section wins.

### 2.1 The problem being solved

Three things are welded together today that shouldn't be:

1. **`trip.status` doubles as the sequencer.** `advance_h2()` checks "is status exactly
   `origin_gate_in`?" and then sets it to `loading`. The status field both describes the trip and
   enforces the order.
2. **The DB allows one of each step.** `UNIQUE(trip_id, handshake_type)` — one `loading` row per trip.
3. **The frontends count to five.** The driver URL is `/trip/handshake/[h]/step/[slug]` with `h`
   ∈ 1–5, and step names live in `Record<1|2|3|4|5, string[]>`.

**Where it breaks.** Cape Town → Bloemfontein → Johannesburg, dropping *and* collecting at
Bloemfontein, needs two loading events and two unloading events. The database cannot store that,
`trip.status` cannot be `loading` twice, and the driver app has no URL for it. That is the wall.

### 2.2 The plan is generated at P0

At trip creation, the phase plan is written out from the trip's stops and consignments — all rows
`pending`. **Length is data.**

*Single-leg (2 stops, all cargo stop 1 → stop 2) — 7 rows:*
```
seq 0  trip_creation   stop=NULL
seq 1  activation      stop=1
seq 2  loading         stop=1
seq 3  departure       stop=1
seq 4  in_transit      stop=1     (the leg leaving stop 1)
seq 5  unloading       stop=2
seq 6  confirmation    stop=2
```

*Three-stop cross-dock (A: 1→3, B: 1→2, C: 2→3) — 11 rows:*
```
seq 0  trip_creation   stop=NULL
seq 1  activation      stop=1
seq 2  loading         stop=1     (A, B pick up here)
seq 3  departure       stop=1
seq 4  in_transit      stop=1
seq 5  unloading       stop=2     (B delivers here)
seq 6  loading         stop=2     (C picks up here)
seq 7  departure       stop=2
seq 8  in_transit      stop=2
seq 9  unloading       stop=3     (A, C deliver here)
seq 10 confirmation    stop=3
```

**The generation rule**, in words: for each stop in sequence, emit `activation` (first stop only) or
`unloading` (if any consignment delivers here); then `loading` (if any consignment picks up here);
then `departure` + `in_transit` (unless it's the final stop). Emit `confirmation` at the final stop.
`sequence_number` is simply the row's index in the emitted list.

**The single-leg trip is the degenerate case of the multi-stop plan — one code path, forever.**

### 2.3 Position is derived, never stored

```
current phase = the lowest-sequence phase_event whose status is not in (completed, overridden)
next phase    = the same row (this is why one query answers both endpoints)
```
`Trip.status` drops to `created → active → closed`, plus `cancelled` and `exception_hold`. It stops
being the sequencer entirely and becomes a plain description.

**Why this is the defensible pattern:** a stored status can drift from what actually happened; a
derived one cannot. For an evidence system, that difference is the entire point. `current_phase` /
`current_stop` exist purely so list views don't have to recompute across every trip — they are
caches of the derivation, and no write path may trust them.

### 2.4 `advance_phase()` replaces five functions

```
1. Load the phase_event by id; verify the trip belongs to the calling driver.
2. Reject if the trip is closed/cancelled, or held at exception_hold.
3. Idempotency: if the phase is already completed → return current state, 200. Stop here.
4. Gate: every phase with a lower sequence_number must be completed or overridden.
   ← the gate reads the PLAN, not trip.status. This is the whole refactor in one line.
5. Write the phase-type-specific evidence (§2.5).
6. Set status = completed, completed_at = now.
7. Anchor if D7 says so — P0 fail-closed, P3/P6 fail-open with anchor_status recorded.
8. Recompute trip.current_phase / current_stop from the ledger.
9. If no phases remain pending → trip.status = closed, closed_at = now.
```

**Idempotency** is keyed on the driver app's offline-queue entry id, carried in the request body and
stored on the row. A replayed submission returns 200 and the current state — never a duplicate, never
an error. Drivers lose signal; replay is normal, not exceptional.

### 2.5 What each phase captures

| Phase | Actor | Evidence written | Anchored |
|---|---|---|---|
| P0 trip_creation | dispatcher | journey lock hash over committed trip params | ✅ fail-closed |
| P1 activation | driver | phone GPS, geofence verdict, assigned-trailer match; opens the PP poll window | — |
| P2 loading | system (PP mock) | `parcel_manifest_snapshot`, `parcel_count_origin` — **no driver input** | — |
| P3 departure | driver | **`seal_number`**, seal photo, waybill photo, departure time | ✅ fail-open |
| P4 in_transit | system + driver | checkpoint batch reference, arrival | — (checkpoints batch separately) |
| P5 unloading | driver | seal verified **before** the doors open; driver visual count | — |
| P6 confirmation | driver | POD photo **and** POD signature; server-side reconciliation result | ✅ fail-open |

**The seal is captured at P3, not P2.** This is the single most dangerous line in the refactor —
see §7 Stage 2.6.

**The driver never sees or types the PP count (F1).** If the driver can see the expected number, a
"match" proves nothing. The server reconciles privately at P6 and returns only a result.

### 2.6 What stays exactly as it is

Non-goals, stated so nobody widens the work: the capture components (camera, GPS, seal input,
signature pad) are already generic and stay generic — only the *sequence* becomes data. No visual
redesign of the dispatcher. No Pulsit integration. No change to journey-lock-hash semantics beyond
covering the phase plan. No live PP load/unload status — it does not exist (spec §6).

---

## 3. The frozen contract (Stage 0.4 deliverable)

The single artifact Tim builds to. Freeze before either side writes feature code.

### 3.1 Phase descriptor (served to the UI)
```ts
PhaseDescriptor {
  phase_event_id: UUID
  phase_type: PhaseType          // D5
  trip_stop_id: UUID | null      // null only for P0 (D3)
  stop_sequence: int | null      // convenience mirror for UI grouping
  sequence_number: int           // position in the committed plan (NOT an enum index)
  status: 'pending'|'in_progress'|'completed'|'exception'|'overridden'
  anchor_status: 'not_required'|'pending'|'anchored'|'failed'   // D4
  step_recipe: string[]          // static per phase_type — capture-component slugs
  // evidence fields populated once completed (seal_number, artifact ids, verdict, counts…)
}
```

### 3.2 Endpoints
```
GET  /trips/{id}/phases                            -> PhaseDescriptor[]   (plan + current state)
GET  /trips/{id}/next-phase                        -> PhaseDescriptor | null
POST /trips/{id}/phases/{phase_event_id}/complete  -> TripDetailResponse
     (idempotent; body carries idempotency_key = offline-queue entry id)
```
`TripDetailResponse.phases` replaces `.handshakes`. The five `/h{n}/complete` routes and the
`GET /{handshake_type}` detail route are retired.

### 3.3 Shared TS types (Ciaran writes — D9)
`frontend/shared/lib/types/phase.ts` (replaces `handshake.ts`),
`frontend/shared/lib/constants/phase-meta.ts` (replaces `handshake-meta.ts` — step recipes per phase
type), `status-meta.ts` (coarse trip statuses + phase labels),
`frontend/shared/lib/mocks/trips.ts` (**phase-shaped mocks — this is what unblocks Tim**).

> **Contract fence:** it must express the *single-leg* trip as the degenerate case of the *multi-stop*
> plan — one code path. **If any part of the contract hard-codes "6 phases" or "sequence 0..6", it is
> wrong. Length is data.**

> **Carry a known fix:** shared `HandshakeEvent` (TS) is missing `pod_signature_artifact_id`, which
> backend `HandshakeEventRead` does return — a live contract drift. Do not port the bug into `phase.ts`.

---

## 4. Chosen approach & rejected alternatives

**Chosen — plan-driven phase ledger (Scope B).** Coarse `TripStatus`; phase order generated at P0;
trip position derived from the `phase_events` ledger; per-stop phase events; both frontends
plan-driven off the contract.

- *Rejected — cosmetic rename (Scope A only).* Cheapest, but proves nothing new and re-hard-wires the
  single-leg shape. Fails the feasibility thesis. (The vocabulary win comes free with Scope B anyway.)
- *Rejected — per-stop refactor without the rename.* Same engineering, worse clarity, and the
  CLAUDE.md prose stays stale. No reason to keep "handshake" once the ledger is plan-driven.
- *Rejected — all four devs, one branch.* Maximises collision. The contract-seam split is what makes
  this parallelisable and demo-safe.

---

## 5. Data strategy — rename + additive DDL + reseed

### 5.1 Schema (Alembic, chained after `tim_add_exception_gps`, name-tagged)
- `handshake_events` → `phase_events` (D1). `handshake_type` → `phase_type` with the D5 value set.
- Add nullable `trip_stop_id` FK → `trip_stops.id`; uniqueness per D3.
- Add `anchor_status` (D4) and `idempotency_key`.
- `sequence_number` becomes plan-derived (no longer an enum index).
- `trips.status` values go coarse; add `current_phase` / `current_stop` (D6).
- `trailer_gps_snapshots.handshake_event_id` → `phase_event_id`.
- `exceptions.handshake_event_id` → `phase_event_id`; start populating its already-present
  `trip_stop_id` / `consignment_id` (the model comment already reserves them for this refactor).

### 5.2 🔴 RLS — silent-failure territory
`0003_tom_rls_policies.py` (rev `0004`) touches `handshake_events` in four places:
1. The `ENABLE ROW LEVEL SECURITY` enumeration (line 64).
2. Three named SELECT policies: `handshake_events_dispatcher_select`, `_driver_select`,
   `_client_viewer_select` (lines 266–300).
3. The `trailer_gps_snapshots` dispatcher policy **joins through it** (lines 456–462).
4. The `downgrade()` teardown lists (lines 534–536, 560).

**FastAPI connects as `service_role` and bypasses RLS, so nothing fails loudly if this is missed.**
The failure mode is a phase ledger carrying driver GPS and seal data sitting outside the POPIA
posture, readable via PostgREST. Treat it as a security control, not housekeeping.

Under D1 (rename) the policies follow the table automatically, **but their names go stale**
(`handshake_events_driver_select` on a `phase_events` table). Rename them in the same migration, and
re-point the `trailer_gps_snapshots` policy body to `phase_event_id`.

### 5.3 Data — regenerate, don't migrate
Existing rows are old-shape and anchored over old payloads. **Truncate + reseed lifecycle tables
only:** `trips`, `consignments`, `parcels`, `trip_stops`, `trip_trailers`, `phase_events`,
`trailer_gps_snapshots`, `checkpoints`, `evidence_artifacts`, `exceptions`, `driver_substitutions`,
`merkle_batches`, `merkle_batch_leaves`, trip-scoped `blockchain_receipts`.
Use `TRUNCATE … CASCADE` from `trips` and let PG walk the FKs, then **assert reference-table row
counts are unchanged**.

**Reference data survives untouched:** organizations, precincts, drivers, vehicles, users.

> 🔴 **`scripts/seed_demo.py` cannot do any of this today — this is new code, not an edit.** The
> existing script is 93 lines of idempotent upserts for **reference data only** (2 orgs, 1 user, 2
> drivers, 2 vehicles, 2 precincts). It creates **zero trips**, imports no trip/handshake model, and
> has no truncate logic. Silver lining: because it only touches reference data and is upsert-based,
> "truncate lifecycle + re-run `seed_demo`" is safe by construction.

> **Fence:** no data-migration that re-derives `trip_stop_id` or splits H4+H5→P5 on existing rows.
> Prototype demo data is regenerated, not preserved.

### 5.4 🔴 Database isolation — required before Stage 1
**§9's demo safety net promises a fallback to the working H0–H5 flow. That fallback needs a database
on the old schema.** Running Stage 1's migration against the single shared dev DB destroys it. Three
databases, decided before Stage 1 starts:

| Purpose | Where | Notes |
|---|---|---|
| **Fallback / current flow** | existing Supabase project | **Do not migrate.** This is the demo insurance. |
| **Refactor dev** | second Supabase project | `DATABASE_URL` points here while on `Phase-refactor`. Migration state is per-database → `alembic upgrade head` from scratch, then `seed_demo.py`. |
| **Tests** | local Docker Postgres | `TEST_DATABASE_URL` (Stage 0.1). No Postgres exists in `docker-compose.dev.yml` today — only redis/api/worker/web. Local matches the CI service container. |

**Also `pg_dump` the current DB before Stage 1**, regardless. `alembic downgrade` reverts *schema
only* — it is **not** a backup, and §5.3's truncate is irreversible without a dump. The dump is the
only thing protecting reference data created through the UI rather than through `seed_demo.py`
(drivers, vehicles, precincts added during development are not in the seed script).

**Why the refactor DB must be Supabase and not local Postgres:** migrations
`0002_tom_supabase_auth_schema.py` and `0003_tom_rls_policies.py` depend on Supabase's built-in
`auth` schema (`auth.jwt()`, `auth.uid()`). `alembic upgrade head` fails on plain Postgres. The test
DB has no such constraint — see §5.5.

### 5.5 New Supabase project — setup checklist
Supabase branching needs a paid tier, so the refactor DB is a **second free project**. Note the free
tier caps active projects (2 at time of writing) — if you're at the cap, pause an unused one first.

**You do not migrate tables by hand. Alembic rebuilds the whole schema.**

1. Create the project. Region is a dev concern only — POPIA's `af-south-1` requirement is about
   production, not this database.
2. Wire the new project's values into **three** files, under two different variable names:

   | Variable | Goes in | Consumed by |
   |---|---|---|
   | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | `backend/.env` | `config.py:35-36` |
   | `SUPABASE_SERVICE_ROLE_KEY` | `backend/.env` **only** | `config.py:74` |
   | `DATABASE_URL` | `backend/.env` **only** | session-mode pooler, **port 5432** (keeps prepared statements working) |
   | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `dispatcher/.env.local` **and** `driver-pwa/.env.local` | `dispatcher/lib/supabase/client.ts:3-4`, `driver-pwa/lib/supabase.ts:6-7` |

   > 🔴 **`SUPABASE_SERVICE_ROLE_KEY` must never carry a `NEXT_PUBLIC_` prefix.** Next.js inlines
   > every `NEXT_PUBLIC_*` value into the client bundle at build time, and `service_role` bypasses
   > RLS entirely — the only control protecting the phase ledger's GPS and seal data (§5.2). For
   > driver-pwa it is worse still: `output: 'export'` bakes the value into the shipped Android APK,
   > where it cannot be rotated out of installed builds.

   > **Gotcha:** driver-pwa's `NEXT_PUBLIC_*` values are frozen at **build** time (`output: 'export'`).
   > Editing `.env.local` and restarting dev is not enough — rebuild (`npm run build`, then
   > `cap sync` for the APK). The dispatcher picks changes up on restart.
3. `cd backend && .venv/bin/alembic upgrade head` — replays all 18 migrations, `0001` →
   `tim_add_exception_gps`. This is the entire schema migration.
4. **Create the storage bucket manually.** `app/storage/supabase_storage.py` hard-codes `_BUCKET`
   ("one bucket per environment, never configurable") — Alembic knows nothing about it, and artifact
   upload fails silently-ish without it. Use the same name as the current project.
5. 🔴 **Provision auth users before seeding — auth does not transfer between projects.**
   Migration `0002` adds hard FKs: `users.id` and `drivers.id` both
   `REFERENCES auth.users(id) ON DELETE CASCADE` ("users.id must equal the Supabase Auth UUID for
   `auth.uid()` to resolve"). On a fresh project `auth.users` is empty, so **`seed_demo.py` as it
   stands fails with a foreign-key violation** on its `User` and `Driver` inserts.

   **Decision (2026-07-27): the system runs on real Supabase Auth, not `DEMO_MODE`.** This makes the
   bootstrap *simpler*, not harder — the hardcoded `_DEMO_USER_ID` exists only to satisfy the
   `DEMO_MODE` stub, and real auth doesn't need a fixed UUID at all:
   ```
   create_dispatcher_auth_user(email, …, role)  -> auth UUID  -> insert User(id=<that UUID>)
   create_driver_auth_user(phone, full_name)    -> auth UUID  -> insert Driver(id=<that UUID>)
   ```
   Both helpers live in `app/integrations/supabase_admin.py` and already set `app_metadata.role`
   correctly. This is exactly the pattern `POST /drivers` uses, so the seeder ends up aligned with
   production behaviour rather than working around it.

   **Rewrite `seed_demo.py` accordingly in Stage 1.5.** Two consequences to handle explicitly:
   it gains a network dependency (needs `SUPABASE_SERVICE_ROLE_KEY`), and it stops being purely
   idempotent — the helpers raise `DuplicateResourceError` on re-run rather than skipping.
6. `.venv/bin/python scripts/seed_demo.py` — now that the FKs are satisfiable.

> 🔴 **`DATABASE_URL` and `SUPABASE_URL` must point at the same project.** `auth.users` lives in the
> same Postgres instance as `public.users`, and the `0002` FK is intra-database. Provisioning against
> project A's admin API while `DATABASE_URL` points at project B lands the row in A's `auth.users`
> while B's FK still rejects the insert — with an error that does not obviously say why. Do not keep
> the old project for auth and the new one for data.

> **Pre-existing gap, not caused by this refactor:** `seed_demo.py` cannot bootstrap a clean database
> today — it predates the `0002` auth FKs. The team has only avoided this by always working against
> one long-lived dev DB. Stage 1.5 fixes it as a side effect of the real-auth decision.

> ⚠️ **Demo risk — resolve before demo week, not on the day.** Driver login is phone OTP. Live SMS on
> stage depends on Twilio, network, and delivery timing you don't control. Mitigate by
> pre-authenticating the device so the session persists, or by using Supabase test phone numbers with
> a fixed OTP.

> ⚠️ **Two consequences of how tests are built — both already reflected in the Stage-1 gate, but know
> the reason.** `tests/conftest.py:172-174` builds the test schema with `Base.metadata.create_all()`,
> **not Alembic**. Therefore:
> 1. **The test suite never exercises your migrations.** A broken migration passes CI clean. Running
>    `alembic upgrade head` *and* `downgrade -1` by hand is the only check that exists.
> 2. **RLS policies never exist in the test DB**, so no test can ever catch RLS breakage. The
>    `pg_policies` assertion in the Stage-1 gate is the only guard. See §5.2.
>
> This is also why the **test DB can be plain local Docker Postgres** — `create_all` needs no `auth`
> schema, so `TEST_DATABASE_URL` costs nothing and matches the CI service container.

### 5.6 Promotion path — refactor DB → the shared dev DB

**The old database is never overwritten by the new one.** Databases are not copied; the same
version-controlled migration is replayed against them. Promotion is one command:
```
DATABASE_URL=<old-db> .venv/bin/alembic upgrade head
```
A data copy would be strictly worse — unreviewed, unrepeatable, and it would drag the refactor DB's
throwaway test trips into the real environment. Lifecycle data doesn't need copying regardless:
§5.3 truncates and reseeds it, and reference data is regenerated by `seed_demo.py`.

**🔴 Sequencing rule: do not promote before the presentation.** §9's safety net — falling back to
the H0–H5 flow if Go/No-Go fails — exists *only while the old database is still on the old schema*.
Promoting it during demo week spends the insurance in the week it's most needed. Promote after the
presentation, or after a confirmed-green demo at the earliest.

**Migration-file lifecycle (the four-dev rule, easiest one to break by accident):**
- *Before* the phase migration merges to `dev`: only your disposable refactor DB has applied it.
  Rewrite the file as often as Stage 1 needs.
- *The moment it lands on `dev`*: **frozen.** Three other devs have applied it. Further changes need
  a **new** migration, never an edit to the existing one.
- During early iteration prefer **dropping the refactor DB and re-running `upgrade head` from zero**
  over chasing `downgrade` bugs. It's faster, and it proves the migration works from a clean slate —
  exactly the condition it faces at promotion.

**Promotion is a team event, not a solo command.** The single `DATABASE_URL` and the fixed
`_DEMO_ORG_ID`/`_DEMO_USER_ID` seeds indicate the dev DB is shared across all four devs *(confirm
this)*. Every dev's local data goes old-shape the moment it runs. Sequence:
1. Announce, agree a slot, everyone stops writing to it.
2. `pg_dump` the old DB.
3. `alembic upgrade head`.
4. Truncate lifecycle tables + reseed (§5.3).
5. Everyone pulls `dev` and re-seeds locally.

---

## 6. Ownership & sequencing

### 6.1 The split
| Surface | Owner |
|---|---|
| Backend, FastAPI, Alembic, seeder, backend tests | **Ciaran** |
| Dispatcher | **Ciaran** |
| `frontend/shared/` (contract types, meta, mocks) | **Ciaran** — D9 |
| driver-pwa (61 source + 34 test files) | **Tim** |
| CI workflow changes | **Ciaran** (they gate Tim's work) |
| Contract freeze, step recipes | **Joint** |
| Stage 6.1 e2e | **Joint** · 6.2 seeder **Ciaran** · 6.3 docs **Ciaran drafts, 4-reviewer PR** |

### 6.2 Staggered start — Ciaran clears blockers, then Tim begins
Tim does **not** start at Stage 0. He starts at the **Tim Gate**, which is Stage 0 complete:

```
✅ shared/lib/types/phase.ts        frozen and compiling
✅ shared/lib/constants/phase-meta.ts  frozen (step recipes agreed)
✅ shared/lib/mocks/trips.ts        updated to phase shape   ← without this Tim cannot build
✅ driver-pwa CI job                live (lint + type-check + vitest)
✅ Stage 5 re-scoped with Tim       against 95 files, not "~40"
```

Between the Tim Gate and Stage 3, Tim builds against the phase-shaped mocks. He integrates against
live endpoints when Stage 3 lands. **Stage 5 is never the demo dependency** — the demo stands on
Stage 4 (dispatcher) alone.

### 6.3 Proposed schedule — tight, stated honestly
Go/No-Go is ~8 days out; the presentation ~15.

| Dates | Ciaran | Tim |
|---|---|---|
| Jul 27 | Stage 0.1 — **timebox to 1 day** | — |
| Jul 28 | Stage 0.2–0.5 → **Tim Gate opens** | — |
| Jul 29–30 | Stage 1 — model, migration, seeder | Stage 5 begins (mocks) |
| Jul 31 – Aug 2 | Stage 2 — the engine (biggest) | Stage 5 |
| Aug 3–4 | Stage 3.1/3.2 — endpoints + schemas | Stage 5 |
| **Aug 4** | **← GO/NO-GO** | |
| Aug 5–7 | Stage 4 — dispatcher (**the demo**) | Stage 5 integration vs live API |
| Aug 8–9 | Stage 3.3/3.4 if time; Stage 6 | Stage 6 |
| Aug 10 | Demo rehearsal | |
| Aug 11 | **Presentation** | |

**Two deliberate protections of the critical path:**
1. **Timebox Stage 0.1 to one day.** If the newly-live tests reveal deep pre-existing breakage,
   record it and move on. The point is having a net, not a perfect suite.
2. **Stage 3.3 (server-side reconciliation) and 3.4 (fatter anchors) sit *after* Go/No-Go.** Neither
   is needed for the multi-stop proof. Deferring them buys ~2 days on the part that gets presented.

---

## 7. Stages

**The standard gate — run at every stage boundary**, locally before CI:
```
cd backend            && ruff check . && mypy . && pytest
cd frontend/dispatcher && npx tsc --noEmit && npm run lint
cd frontend/driver-pwa && npm run type-check && npm run lint && npm test
```
"pytest green" alone is **not** the gate. The gate is *green with the skip count at or below its
Stage-0.1 floor*. Suggested commits are marked `> Suggested commit:` — Ciaran runs git; plans never do.

---

### Stage 0 — Make the tests real, freeze the contract  *(Ciaran; gate for everything)*

**Achieves:** a test suite that actually covers the state machine being replaced, CI coverage for
both frontends, and a frozen contract Tim can build against.
**Why first:** the refactor's core deliverable is replacing `advance_h1..h5`. Every test covering
those functions is currently skipped. Doing this after Stage 2 means discovering it at Go/No-Go.

- **0.1 🔴 Turn on the 133 skipped tests.** Add `TEST_DATABASE_URL` to `backend/.env.example` (key
  name only) and to the CI backend job against a throwaway Postgres service container. Run the suite
  and triage what the newly-live tests reveal — **treat any failure as a pre-existing bug to record,
  not as refactor breakage.** *Timeboxed to one day.*
  **Where:** `backend/.env.example`, `.github/workflows/ci.yml`*, possibly `tests/conftest.py`.
  **Fence:** test infrastructure only — no `app/` edits.
  **Exit:** record the new passed/skipped numbers in this plan. That skip count is the floor every
  later stage must not exceed.
- **0.2 Add a driver-pwa CI job.** Mirror the dispatcher job (`npm ci`, `lint`, `type-check`, `test`).
  Scripts exist; only the workflow is missing. **Where:** `.github/workflows/ci.yml`*.
- **0.3 Quantify what Tim's merged work already gives P1.** Read `useLocation`, the geofence verdict,
  and trip-gating. This may *shrink* Stage 5 materially, and Tim needs the number before he commits
  to a date. **Fence:** analysis only, no code.
- **0.4 Freeze the contract** (§3) with Tim in the room: phase types, descriptor, endpoints, step
  recipes per phase type. Write `phase.ts`, `phase-meta.ts`, **and the phase-shaped
  `shared/lib/mocks/trips.ts`** so Tim is unblocked. **Where:** `frontend/shared/lib/`.
- **0.5 Confirm the `main`/`dev` divergence plan** (§0.2) — owner and date. Decision, no code.

**Verification:** standard gate passes · skip count recorded and dramatically below 133 · shared TS
types compile and import cleanly from both apps · contract signed off by Ciaran + Tim.
**Done when:** the Tim Gate (§6.2) is fully open.
**Visible:** a test suite that tests the state machine, and a frozen contract both devs agree on.
> Suggested commit: `test(backend): run DB-backed suite in CI` · `ci: add driver-pwa lint/type/test job`
> · `feat(shared): frozen phase contract types, meta and mocks`

---

### Stage 1 — Data model, migration, seeder  *(Ciaran)*

**Achieves:** the phase ledger exists in the database, with RLS intact, and both a single-leg and a
multi-stop trip can be seeded into it.
**Why before the engine:** the engine has nowhere to write until the shape exists, and the migration
is the one step that is genuinely hard to undo.

- **1.1** `enums.py`: `HandshakeType` → `PhaseType` (D5), `TripStatus` → coarse,
  `SubjectType.HANDSHAKE_EVENT` → `PHASE_EVENT`. **Fence:** don't touch `advance_*` yet.
  > **Free win:** `TripStatus.ORIGIN_GATE_OUT` and `UNLOADING` are already dead values — no
  > `advance_*` ever assigns them (`advance_h3` → `IN_TRANSIT`, `advance_h5` → `CLOSED`). The coarse
  > collapse is gentler than it looks.
- **1.2** Models: `HandshakeEvent` → `PhaseEvent` with `trip_stop_id`, `anchor_status`,
  `idempotency_key`, D3 uniqueness; `Trip` gains `current_phase` / `current_stop`;
  `TrailerGpsSnapshot` and `TripException` re-point to `phase_event_id`.
  **Where:** `db/models/handshakes.py`→`phases.py`, `trips.py`, `transit.py`, `__init__.py`*.
- **1.3** Alembic migration chained after `tim_add_exception_gps`, name-tagged.
  **Includes the §5.2 RLS work explicitly** — enumerate it, don't assume the rename covers it.
- **1.4** Schemas: delete `HandshakeEventCreate.validate_sequence_number`, which hard-codes
  `0 <= v <= 5` with the message "H0–H5" (`schemas/handshakes.py:23-28`). Sequence length is data now.
- **1.5** **New** trip seeder + truncate routine (§5.3): emit a single-leg **and** a multi-stop trip in
  the new phase shape; truncate lifecycle tables only; assert reference-table counts unchanged.
  **Also rewrite the reference-data seeder for real auth** (§5.5 step 5): provision via
  `supabase_admin.create_dispatcher_auth_user()` / `create_driver_auth_user()` and use the returned
  UUIDs as `users.id` / `drivers.id`, instead of hardcoding `_DEMO_USER_ID` and `uuid4()`. This is
  what makes a clean-database bootstrap possible at all.

**Verification:** standard gate · `alembic upgrade head` **and `downgrade -1`** both green on a fresh
DB (a one-way migration is not a migration) · seeder runs · `GET /trips` shows new-shape trips ·
reference data intact · **`SELECT * FROM pg_policies WHERE tablename='phase_events'` returns 3 rows**
and `relrowsecurity` is true.
**Done when:** a multi-stop trip with 11 phase rows exists in the DB and survives a downgrade/upgrade.
> Suggested commit: `feat(db): phase-event ledger, coarse trip status, current_phase denorm + migration`

---

### Stage 2 — The phase engine  *(Ciaran; the core of the refactor)*

**Achieves:** plan generation, one `advance_phase()`, derived position, idempotency, and the two
behaviour changes (seal location, fail-open anchors).
**Why it's the core:** everything before is scaffolding and everything after is presentation. This is
where "the ledger is the truth" stops being a sentence and becomes code.

- **2.1** Plan generation at P0 (§2.2): trip creation emits ordered pending `PhaseEvent` rows from
  stops + consignments. **Where:** `orchestration/trip_service.py`. **Fence:** don't change lock-hash
  semantics beyond covering the phase plan (FP-113).
- **2.2** `advance_phase()` (§2.4) replacing `advance_h1..h5`. Gate on the **plan**, not `trip.status`.
  **Where:** `orchestration/handshake_service.py` → `phase_service.py`.
  **Fence:** leave the anchor policy alone here — that's 2.5.
  > Note `_get_handshake_event` derives `sequence_number` from `list(HandshakeType).index(...)`
  > (`handshake_service.py:76`). That enum-index-as-sequence is exactly what plan-derived sequencing
  > replaces.
- **2.3** `next-phase` computation + `current_phase`/`current_stop` maintenance on each completion.
- **2.4** Idempotent completion keyed by offline-queue id — replay returns current state, 200.
  **Fence:** idempotency by key only; do not loosen the sequence gate.
- **2.5 🔴 Switch P3/P6 anchors from fail-*closed* to fail-open.** Today `anchor_subject()` raises
  uncaught and the endpoint maps it to 504/502, deliberately leaving the trip un-advanced
  (`handshake_service.py:176-186`, `:345-353`). Fail-open means: catch, complete the phase, persist
  `anchor_status='failed'`, log, leave a retry path.
  **Fence:** P0 stays fail-closed — `create_trip` must still roll the whole trip back on anchor
  failure. **Do not land this without `anchor_status` from 1.2**, or a Hedera outage silently yields
  completed phases with no receipt and no record one is owed.
- **2.6 🔴 Re-point the seal comparisons from P2 to P3.** Today the authoritative seal lives on the
  `LOADING` row and three functions fetch it by `handshake_type == LOADING`
  (`handshake_service.py:224`, `:270`, `:328`). All three must read P3.
  **Fence: write the failing test first.** A P5 seal mismatch must still raise `SEAL_MISMATCH`. A
  silent `NULL == NULL` here raises nothing, fails no test, and destroys the tamper-evidence story
  while the dispatcher shows a clean chain. **This is the highest-risk edit in the refactor.**
- **2.7** Re-point payload reconstruction: `verification_service._reconstruct_handshake_event_payload`
  branches on `HandshakeType.LOADING`/`UNLOADING` (`:142`, `:153`), and
  `blockchain/subject_visibility.py` branches on `SubjectType.HANDSHAKE_EVENT` (`:62-69`).
  **Fence:** verification must rebuild byte-identical payloads, or `/verify` returns `db_mismatch` on
  a healthy trip — which the dispatcher UI reads as **tamper detected**. Worse than an error.

**Verification:** standard gate · a pytest walk drives a single-leg trip P0→P6 through the service
layer · `next-phase` correct at each step · duplicate completion returns 200 · `current_phase` tracks
· **a P5 seal mismatch still raises** · **a simulated Hedera failure completes the phase with
`anchor_status='failed'`** · **`/verify` returns `verified` for a freshly anchored phase.**
**Done when:** an 11-row multi-stop plan walks end to end through the service layer.
> Suggested commit: `feat(orchestration): plan-driven phase engine — generation, advance, next-phase, idempotency`

---

### Stage 3 — Endpoints, schemas, reconciliation, fatter anchors  *(Ciaran)*

**Achieves:** the frozen contract becomes live HTTP. **3.1/3.2 are critical path; 3.3/3.4 are
deferred past Go/No-Go by design (§6.3).**

- **3.1** Endpoints: `GET /phases`, `GET /next-phase`, `POST /phases/{id}/complete`. Retire the five
  `/h{n}/complete` routes and `GET /{handshake_type}`.
  **Where:** `endpoints/handshakes.py`→`phases.py`, `main.py`*. **Fence:** match §3 exactly.
  **Note:** the 504/502 Hedera handlers on the h2/h5 routes disappear with the fail-open switch —
  deleting them is part of the change, not an oversight to be caught in review.
- **3.2** Schemas: `PhaseEventRead`; per-phase complete requests folded into one shape;
  `TripDetailResponse.phases`. Plus `resource_service.get_trip_detail`, which orders by
  `HandshakeEvent.sequence_number` and filters receipts by `SubjectType.HANDSHAKE_EVENT`
  (`resource_service.py:163-191`) — re-point both, return the list plan-ordered.
- **3.3** *(post-Go/No-Go)* Server-side reconciliation (F1): the driver never sends or sees the PP
  count; P6 returns a result. **Fence:** mock-first. Do **not** claim live PP load/unload status —
  `ecomService v28` cannot supply it (spec §6).
- **3.4** *(post-Go/No-Go)* Fatter anchor payloads (F4): fold artifact SHA-256s, GPS, timestamps and
  the snapshot hash into the anchored payload. **Fence:** do this before wiring any further anchors.

**Verification:** standard gate · integration tests hit the live endpoints for a full single-leg walk
**and actually execute** (they live in `tests/integration/`, the set that was 100% skipped before
0.1 — confirm with `pytest -rs`).
**← GO/NO-GO GATE (~2026-08-04):** backend contract + migration + one end-to-end walk working?
**Yes** → push through Stage 4 (the dispatcher proof *is* the demo). **No** → freeze, demo the current
H0–H5 flow (§9).
> Suggested commit: `feat(api): phase endpoints and schemas` · `feat(api): server-side reconciliation, artifact-covering anchors`

---

### Stage 4 — Dispatcher re-wire  *(Ciaran; this is the demo)*

**Achieves:** the contract proven against a real consumer, and the feasibility thesis made visible —
a multi-stop trip's derived phases and evidence, with no driver app involved.

- **4.1** Wire `TripDetailResponse.phases` off the frozen types.
- **4.2** Trip detail: replace `ACTIVE_HS_FOR_STATUS[trip.status]` (`trips/[id]/page.tsx:25`) with
  derived-active-phase from the ledger; render a variable-length timeline; re-bind evidence/verdict/
  seal panels. Also the hard-coded `sequence_number === 0 / === 2` lookups at `:268-272`.
  **Fence:** reuse existing visual components. No redesign.
- **4.3** `HandshakeChain` → `PhaseChain`: render N nodes from the phase list.
- **4.4** Trip list/filters: active/closed off coarse status; phase-level filter/sort off
  `current_phase`. **Where:** `lib/hooks/useTrips.ts`, `app/(app)/page.tsx`, `history/page.tsx`.
- **4.5** The coarse-status ripple, named: `useStepIndicator.ts` reads the fixed-length
  `HANDSHAKE_STEP_COUNTS`/`STEP_NAMES`, and `useSLAMetrics.handshakeCompletionPct` assumes a fixed
  denominator. Both must take their length from the plan.

**Verification:** standard gate · trip-detail shows a plan-driven timeline for **both** a single-leg
and a multi-stop seeded trip · list filters by derived phase · evidence/verdicts render · the SLA page
shows sane percentages for an 11-phase trip (not >100%).
**Done when:** you can walk a reviewer through a multi-stop trip's phases on screen.
> Suggested commit: `feat(dispatcher): plan-driven phase timeline + coarse-status trip lists`

---

### Stage 5 — Driver-app plan-driven engine  *(Tim; starts at the Tim Gate)*

**Achieves:** the driver walks whatever plan the trip has, rather than a fixed 1–5 route.
**Scope: 95 files (61 source + 34 test), not "~40".** Re-scope with Tim before he commits to a date;
Stage 0.3 may shrink it materially.

- **5.1** Fetch the phase plan; replace the `[h]` 1–5 route and fixed-length constants with
  descriptor-driven steps; keep URL-as-state (key by phase-event id, or `stop/{k}/{type}`).
  **Fence:** capture components stay generic — only the *sequence* becomes data.
- **5.2** P6 reconciliation → await/result screen, no PP-count input.
- **5.3** Idempotency key from the offline-queue id on submit.
- **5.4** The 18 `H{n}*.tsx` step components carry the old model in their filenames. **Decide once**
  whether they rename now or stay behind the descriptor indirection. Either is fine; drifting
  halfway is not.

**Verification:** `npm run lint && npm run type-check && npm test` green (now CI-enforced) · a driver
walks a seeded trip through its phases in the dev build · offline replay of a completed phase is a
no-op · no cargo count is shown to the driver.
> Suggested commit (Tim): `feat(driver-pwa): plan-driven phase step engine`

---

### Stage 6 — Integration, multi-stop proof, demo  *(joint)*

- **6.1** *(joint)* End-to-end: dispatcher + driver on one multi-stop trip; phases stay in sync.
- **6.2** *(Ciaran)* Reseed the demo dataset; script the demo narrative. **State plainly in the script
  that PP load/unload completion is simulated** (spec §6). Over-claiming there is exactly what gets
  probed at a presentation.
- **6.3** *(Ciaran drafts)* Docs: CLAUDE.md's "Five handshakes" prose and `orchestration/` description
  both encode the old model — **4-reviewer PR, so raise it early in Stage 6, not on the last day.**
  Plus Technical Full Picture v1.1 and the glossary.

**Verification:** standard gate across backend and both frontends · a full multi-stop trip walked
end-to-end across both surfaces · demo dataset loads clean · **final skip count at or below the
Stage-0.1 floor.**
**Done when:** the feasibility thesis is demoable from a cold start.
> Suggested commit: `feat: phase model end-to-end + multi-stop demo dataset` · `docs: phase vocabulary sweep`

---

## 8. Files in scope (measured against `dev @ 802215a`)

`grep -ril handshake`, excluding `node_modules`/`.next`:

| Surface | Files |
|---|---|
| Backend (`*.py`) | **33** |
| Dispatcher | **7** |
| Shared | **9** |
| Driver-pwa | **95** (61 source + 34 test) |

**Backend (Ciaran):** `db/models/enums.py`, `db/models/handshakes.py`→`phases.py`,
`db/models/trips.py`, `db/models/transit.py`, `db/models/evidence.py`, `db/models/__init__.py`*,
`orchestration/{trip,handshake→phase,resource,verification,checkpoint,exception}_service.py`,
`api/v1/endpoints/handshakes→phases.py`, `api/v1/endpoints/{trips,artifacts}.py`, `main.py`*,
`schemas/handshakes→phases.py`, `schemas/{trips,transit,__init__}.py`, `core/exceptions.py`
(`HandshakeSequenceError`→`PhaseSequenceError`), `blockchain/anchor_service.py`,
`blockchain/subject_visibility.py`, `integrations/parcel_perfect.py`,
`migrations/versions/2026_*_ciaran_phase_model.py`, `backend/scripts/seed_demo.py`, backend tests
(`test_handshake_service.py`, `test_handshake_anchor_payload.py`, `test_verification_service.py`,
`test_subject_visibility.py`, `test_schema_validators.py`, `test_handshakes*.py`, `test_trips.py`,
`test_detail_receipts_gating.py`).

**`core/config.py` is NOT in scope** — `PP_POLL_INTERVAL_SECONDS` already exists (`config.py:92`, and
in `.env.example`). **The refactor requires no new `.env` keys**; Stage 0.1 adds `TEST_DATABASE_URL`
for tests only.

**Dispatcher (Ciaran):** `app/(app)/trips/[id]/page.tsx`, `components/domain/HandshakeChain→PhaseChain.tsx`,
`components/domain/ChecklistRow.tsx`, `components/domain/TripCreatedDetail.tsx`,
`lib/hooks/useStepIndicator.ts`, `lib/hooks/useSLAMetrics.ts`, `app/(app)/sla/page.tsx`,
`lib/hooks/useTrips.ts`, `app/(app)/page.tsx`, `history/page.tsx`.

**Shared (Ciaran — D9):** `lib/types/handshake→phase.ts`, `lib/constants/handshake-meta→phase-meta.ts`
(`HANDSHAKE_NAMES`, `HANDSHAKE_STEP_COUNTS`, `STEP_SLUGS`, `STEP_NAMES` — all `Record<1|2|3|4|5, …>`:
the fixed-length assumption in literal form), `lib/constants/status-meta.ts`, `lib/constants/copy.ts`,
`lib/mocks/trips.ts`, `lib/types/trip.ts`, `lib/types/evidence.ts`, `lib/types/exception.ts`,
`lib/types/seal.ts`.

**Driver-pwa (Tim):** `app/(app)/trip/handshake/[h]/step/[slug]/` (the `[h]` 1–5 segment is the
fixed-length assumption in the URL itself), 18 `H{n}*.tsx` components under
`components/handshake/steps/`, `lib/navigation/`, `lib/constants/`, plus 34 test files.

`*` = heavily-shared registration files — flag every change in the PR.

---

## 9. Risks & tripwires

| Risk | Early warning | Fallback |
|---|---|---|
| 🔴 **Green tests prove nothing** — 133/320 skip; every `advance_h*` test among them | Already true; `pytest -rs` shows it | Stage 0.1 is a hard gate. Record the skip floor; any stage that raises it fails |
| 🔴 **Seal comparison silently reads NULL** after P2→P3 (3 call sites) | **No warning** — tests pass, mismatches stop being raised, chain looks clean | Test-first at 2.6. Never merge without a failing-then-passing P5 mismatch test |
| 🔴 **RLS silently dropped** on the renamed table | **No warning** — FastAPI is `service_role` and bypasses RLS | Stage-1 gate asserts `pg_policies` has 3 rows + `relrowsecurity` true |
| 🔴 **`main` lacks Tim's GPS work** (PR #27 revert is in `main`) | The `dev→main` PR conflicts across GPS/handshake files | Resolve as a separate deliberate merge before promoting (§0.2) |
| **Verification reports false tampering** if rebuilt payloads aren't byte-identical | `/verify` returns `db_mismatch` on a healthy trip | Stage 2.7 + gate check. Reads as "tamper detected" in the UI — worse than an error |
| **Fail-open loses receipts silently** | A Hedera blip during the demo yields completed phases with no receipt | `anchor_status` (1.2) is a hard prerequisite for 2.5 |
| **driver-pwa has no CI** — 61 source files unguarded | A Stage-5 regression is only found by hand | Stage 0.2, before the Tim Gate opens |
| **Scope underestimate** (95 driver-pwa files vs "~40") | Tim's estimate was built on the old number | Re-scope at the Tim Gate, before he commits to a date |
| **Contract drift after freeze** | Tim reports a type mismatch mid-Stage-5 | Frozen shared types are the source of truth; changes only by joint agreement + re-freeze (D9) |
| **Coarse-status ripple** — located, not hypothetical | `ACTIVE_HS_FOR_STATUS`, `useStepIndicator`, `useSLAMetrics` all assume fixed length | `current_phase` absorbs list/filter needs; Stage 4.5 fixes the three named sites |
| 🔴 **The fallback demo has no database** if Stage 1 migrates the shared dev DB | No warning until you need the fallback and it's gone | §5.4 — separate refactor DB before Stage 1, plus a `pg_dump`. `alembic downgrade` is schema-only and is **not** a backup |
| **Deadline 2026-08-11** | Go/No-Go ~08-04 not met | Demo the current H0–H5 flow (kept intact on `dev`); present the phase model as backend proof + direction |
| **Environment fragility** (stale Docker 500 seen before) | Local API 500s; container shadows uvicorn | Verify against a clean local backend before blaming code |
| **Exam-defensibility** (graded; must own the patterns) | Can't explain plan generation / derived state / idempotency at review | §2 is written for this. Budget review time per stage; keep patterns conventional |

**Demo safety net.** `dev`/`main` keep the working H0–H5 flow; this refactor lives on
`Phase-refactor`. The presentation must stand on **either** the new proof (Stage 4: dispatcher shows a
multi-stop trip's derived phases, no driver app) **or** the existing flow. Never let the demo depend
on Stage 5 landing.

---

## 10. Open items

### Closed
- ✅ Tim's branch merged (PR #31) — the original Stage-0 merge gate is cleared.
- ✅ Migration head verified `tim_add_exception_gps`; linear, single-headed.
- ✅ File counts re-baselined (backend 33, dispatcher 7, shared 9, driver-pwa 95).
- ✅ Baseline gates measured: ruff clean, mypy clean, pytest 187/133.
- ✅ `PP_POLL_INTERVAL_SECONDS` already exists — no config change, no new `.env` keys.
- ✅ H→P mapping imported from spec §14 (§2.5).
- ✅ **D1–D9 locked 2026-07-27** (§1). Scope B confirmed. Shared-file ownership agreed.

### Still open — needs Tim or the team, not blocking Ciaran's Stage 0/1
1. **Step recipes per phase type** — the last unspecified piece of the contract. Joint, Stage 0.4.
2. **Stage 5 re-scoping** with Tim against 95 files.
3. **`main`/`dev` divergence** — owner and date (§0.2).
4. **Stage 5.4** — rename the `H{n}*.tsx` components now or later. Tim's call, decide once.

### Still open — external, bounds what may be claimed
5. Guard / gate-scan decision (spec R1) — the independent-witness question.
6. Who attests at P6 in a hub cross-dock case (hub staff, not a customer OTP receiver).
7. **RTT/LFG:** seal mechanism, and who produces the authoritative count.

**These do not block starting.** Design so they are swappable, and state the simulation honestly in
the demo script (6.2).

### Still open — code gaps found after Stage 4, scheduled into Stage 6 *(added 2026-08-01)*

Found by a post-Stage-4 audit of the error and lifecycle paths. **All are scheduled as numbered tasks
in `docs/superpowers/plans/2026-08-01-phase-refactor-stage-6-hardening-and-demo.md`** — listed here so
they are indexed in the artifact this project is defended from, not only in the stage plan. The
plain-English version of each, with reproduction steps, is `docs/phase-model-explained.md` §9.

8. ⚠️ **~~`EXCEPTION_HOLD` is a permanent dead-end.~~ — SUPERSEDED 2026-08-05.** The automatic hold
   was removed instead of being given an exit: `advance_unloading`'s seal mismatch no longer sets
   `EXCEPTION_HOLD` (`phase_service.py:895-911` gives three reasons — chiefly that holding the trip
   destroyed the remaining evidence of the very trip whose integrity it was reacting to). Nothing in
   `app/` can hold a trip, so **no `release` path is needed and none is being built.** What survives
   of this item: `PhaseStatus.OVERRIDDEN` and `TripStatus.CANCELLED` are still written by nothing, so
   a phase the driver physically cannot complete still blocks every later phase, and an abandoned trip
   still cannot be cancelled. Stage 6 task **6.1** (`cancel` + `override` only).
9. 🔴 **Empty-leg trips cannot close.** No `loading` row is generated, and `advance_confirmation`'s
   `_find_loading_for_leg` raises rather than returning `None` → permanent 404. Stage 6 task **6.2**.
   *(Stage 2 §421 verified empty legs at plan **generation** and signed off; the completion path was
   never checked, and `_find_loading_for_leg` arrived later in Stage 3.)*
10. 🟠 **No row locking anywhere in the codebase.** Two concurrent completions of one phase both pass
    the gate and **both submit to Hedera before the uniqueness check fires** — and a DB rollback
    cannot un-submit an on-chain message. Stage 6 task **6.3**.
11. 🟡 **Inconsistent error mapping.** `phases.py` has no `SQLAlchemyError` handler (`trips.py` does),
    and `main.py` has **no global exception handler at all**. Stage 6 task **6.4**.
12. 🔴 **CI is red on `Phase-refactor` — and `mypy` is checking nothing** *(found 2026-08-05)*.
    `ruff check .` fails on 2 × `F841`; `mypy .` dies during collection on a duplicate module name for
    `scripts/seed_trips.py`, so **zero files are type-checked** — and behind that halt sit 2 genuine
    type errors in `app/api/v1/endpoints/exceptions.py`. Every "mypy clean" claim on this branch since
    the break is void. Stage 6 task **6.0**, a hard gate on the rest.
13. 🔴 **A trip can be created that can never be activated** *(found 2026-08-05)*. `_reject_if_not_due`
    treats "no schedule" as permanently not-due, but `planned_departure_at` is `Optional` at creation.
    The dispatcher wizard requires one, so the UI path is safe; the API, scripts and seeders are not.
    Decided: require a schedule at creation rather than relax the gate. Stage 6 task **6.0**.

14. 🟠 **The loading parcel-count check compares against the whole trip, not the stop** *(found
    2026-08-05)*. `advance_loading` does raise `PARCEL_COUNT_MISMATCH` on a manifest-vs-driver-count
    discrepancy (`phase_service.py:664-683`) — but `_expected_parcel_count` sums consignments
    trip-wide with no stop filter, so **both loadings on the seeded cross-dock demo trip raise a false
    mismatch**. `Consignment.pickup_stop_id` already exists and is already populated, so the fix is a
    `WHERE` clause. Stage 6 task **6.2b**.
15. 🟠 **`unloading` captures no parcel count at all** *(found 2026-08-05)*, so no count exception can
    be raised there — contradicting §2.5, which specifies P5 as capturing a driver visual count. Cargo
    dropped at an **intermediate** stop is therefore never count-reconciled by anything; P6's
    `WAYBILL_COUNT_MISMATCH` only covers the final leg. **Deferred to the consignment-mapping stage,
    not Stage 6**: the baseline it needs (`delivery_stop_id`) is stamped last-stop-for-everything by
    `trip_service.py:333`, so it cannot be correct until the wizard can express per-consignment stops.

**9, 13 and 14 block the parent's own Stage 6 "Done when".** An empty-leg trip and a scheduleless trip
cannot be walked end-to-end, and the cross-dock demo trip raises false exceptions, so "demoable from a
cold start" is unreachable until all three are closed. **12 blocks merging at all.**

*Stage 6 is planned in detail at `docs/superpowers/plans/2026-08-01-phase-refactor-stage-6-hardening-and-demo.md`
(revised 2026-08-05 against measured state — its §Revision explains what changed and why).*

---

## 11. Stage-plan template

Write stage plans **one stage ahead**, into
`docs/superpowers/plans/2026-MM-DD-phase-refactor-stage-N-<name>.md`.

**Every stage plan must open with the invariants block below**, restated in full. A cold agent does
not know these, and each one fails silently if broken:

```markdown
## Invariants — must not break
- Layering: endpoints → orchestration/auth/storage → integrations/blockchain/crypto → db.
  `integrations/` never imports from `api/` or `orchestration/`. `db/` never imports from `app/`.
- POPIA: only SHA-256 hashes reach Hedera. No GPS, photos, names, or parcel details in any
  canonical payload. Personal data stays in Postgres.
- RLS: FastAPI runs as `service_role` and bypasses RLS, so RLS breakage is SILENT. Any new or
  renamed table must be in the enumeration and carry its policies.
- The ledger is the truth. `current_phase`/`current_stop` are caches — no write path may branch
  on them.
- Length is data. Nothing may hard-code 6 phases or sequence 0..6.
- Anchor policy: P0 fail-closed; P3/P6 fail-open with `anchor_status` recorded; P1/P2/P4/P5 not
  anchored.
- Never run git write commands. Suggest commits; the developer runs them.
- Latest stable only: SQLAlchemy 2.0 `Mapped`/`mapped_column`, Pydantic v2, async endpoints via
  `get_db()`, no `any` in TypeScript.

## Objective          (one sentence — what this stage achieves)
## Why now            (why it comes at this point in the sequence)
## Prerequisites      (what must be true before starting)
## Tasks              (numbered; each with a Where + a Fence)
## Tests to write     (named, with the behaviour each proves)
## Out of scope       (named files, with why — prevents scope creep)
## Verification       (exact commands + expected output)
## Done when          (a single observable condition)
```

---

*Parent plan. Architecture and decisions live here; execution detail lives in the stage plans.
Changes to §1 (locked decisions) need a note explaining what new information reopened them.*
