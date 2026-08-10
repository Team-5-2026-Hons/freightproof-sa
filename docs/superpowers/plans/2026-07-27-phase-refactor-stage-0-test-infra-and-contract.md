# Phase Refactor — Stage 0: Test Infrastructure & Contract Freeze

**Created:** 2026-07-27 · **Owner:** Ciaran · **Branch:** `Phase-refactor`
**Parent plan:** `docs/superpowers/plans/2026-07-25-phase-model-refactor.md` — *that document is the
source of truth. If this plan and the parent disagree, the parent wins.*
**Status:** ready to execute · 0.1 timeboxed to one day (parent §6.3)

---

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

---

## Objective

Make the test suite actually exercise the state machine this refactor replaces, put both frontends
under CI, and freeze the shared TypeScript contract — so that the Tim Gate (parent §6.2) opens.

## Why now

The refactor's core deliverable is replacing `advance_h1..h5`. **Every test covering those functions
is currently skipped** — 12 in `tests/unit/test_handshake_service.py` alone. Writing the phase engine
against a suite that cannot fail is writing it blind, and the discovery would land at Go/No-Go
(~2026-08-04) rather than now. Nothing else in this stage is as load-bearing: 0.2–0.5 are gates for
*Tim*, 0.1 is the gate for *the refactor being verifiable at all*.

---

## Prerequisites

### Verified at 2026-07-27 (re-measured, not trusted)

| Check | Command | Result |
|---|---|---|
| Branch | `git branch --show-current` | `Phase-refactor`, tree clean |
| Backend tests | `backend/.venv/bin/python -m pytest -q` | **187 passed, 133 skipped** |
| Tests collected | `pytest --collect-only` | 320 |
| Lint | `backend/.venv/bin/ruff check .` | All checks passed |
| Types | `backend/.venv/bin/mypy .` | Success — 152 source files |
| Migration head | `backend/.venv/bin/alembic heads` | `tim_add_exception_gps` (single) |
| Docker | `docker --version` / `docker compose version` | 28.1.1 / v2.35.1-desktop.1 |

### Facts established while scoping this stage

1. **No Postgres exists anywhere.** `infrastructure/docker/docker-compose.dev.yml` defines only
   `redis`, `api`, `worker`, `web`, and its header comment states *"Database is Supabase-hosted
   Postgres — no local db service."* `docker ps -a` shows no Postgres container. Task 0.1 creates it.
2. **`TEST_DATABASE_URL` is already a config field** — `backend/app/core/config.py:21`,
   `TEST_DATABASE_URL: str = ""`. No `config.py` change is needed, so the flagged shared file stays
   untouched. Only `.env`, `.env.example`, and CI need the value.
3. **`config.py:118` sets `env_file=".env"`.** Locally `backend/.env` exists, so the
   `os.environ.setdefault` block in `conftest.py:38-53` is skipped entirely and settings come from
   the file — **the value must be added to `backend/.env` locally**. In CI there is no `.env`, that
   block runs, and since `TEST_DATABASE_URL` is *not* among its keys, the workflow `env:` value flows
   straight through. Both paths work, by different routes.
4. **All 133 skips share one cause.** `conftest.py:167-168`,
   `pytest.skip("TEST_DATABASE_URL not set")`, across 25 files:

   | File | Skips | |
   |---|---|---|
   | `tests/integration/` (28 files) | **111** | every integration test |
   | `tests/unit/test_handshake_service.py` | **12** | every state-machine test |
   | `tests/unit/test_handshake_anchor_payload.py` | 5 | |
   | `tests/unit/test_verification_service.py` | 1 | |
   | `tests/unit/test_anchor_service.py` | 1 | |

5. **`conftest.py:161-181` is destructive by design.** The session-scoped `test_engine` fixture runs
   `Base.metadata.create_all()` at start and **`Base.metadata.drop_all()` at teardown** against
   whatever `TEST_DATABASE_URL` names. This is why the test DB must be a throwaway and must never be
   a Supabase project:
   - it would drop every app table in the refactor DB on each pytest run;
   - `alembic_version` is not in `Base.metadata`, so it *survives* — leaving a database that reports
     `tim_add_exception_gps` as applied while no tables exist, and `alembic upgrade head` then
     no-ops;
   - concurrent CI runs would `create_all`/`drop_all` against each other;
   - 133 network round-trips per run replace a 0.57s local suite.

   There is no offsetting benefit: parent §5.5 already establishes that `create_all` needs no `auth`
   schema and that RLS policies never exist in the test DB.

### Not yet true — carried into Stage 1, does not block Stage 0

Refactor project ref **`spjugofbopoyrmmpucjr`** (`eu-west-1`), old/fallback project
**`smaurrwbawosufedubeq`**. Status as at 2026-07-27:

- [x] `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` in
      `backend/.env` repointed to the new project — session-mode pooler, **port 5432**,
      `postgresql+asyncpg://`
- [x] `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` present in **both**
      `frontend/dispatcher/.env.local` and `frontend/driver-pwa/.env.local`
- [x] `alembic upgrade head` replayed against the new project — **`tim_add_exception_gps`,
      24 public tables, 45 RLS policies**
- [ ] **Storage bucket — MANUAL, still outstanding.** Create a bucket named exactly
      **`evidence-artifacts`** in the new project (`_BUCKET`, `app/storage/supabase_storage.py:16`,
      "one bucket per environment, never configurable"). Alembic knows nothing about it and artifact
      upload fails without it.
- [ ] `pg_dump` of the **old** project — do before Stage 1.5's truncate/reseed
- [x] Old project confirmed **unmigrated** — nothing in this session connected to it

> 🔴 `DATABASE_URL` and `SUPABASE_URL` must name the **same** project — the `0002` auth FK is
> intra-database (parent §5.5). **Verified: both `spjugofbopoyrmmpucjr`.**

### Wiring verification script (new, `backend/scripts/check_supabase_wiring.py`)

Written during this stage because three of the four wiring values were wrong in ways that fail
confusingly rather than loudly. Run it before any migration against a new target:

```bash
cd backend && PYTHONPATH=. .venv/bin/python scripts/check_supabase_wiring.py
```

Masked output only — no password or key is ever printed, so it is safe to paste into a PR or chat.
It checks driver scheme, pooler mode, live DB connection, `alembic_version`, `auth.users` count,
JWKS reachability, service_role admin acceptance, and both frontend `.env.local` files. Crucially it
**decodes each legacy key's own `ref` claim**, which is what turned an unexplained `HTTP 401` into
"this `service_role` key belongs to the old project".

**Three real defects it caught on first run**, all since fixed:
1. `DATABASE_URL` used `postgresql://` — the sync psycopg2 driver, which is not installed. This broke
   `app/db/session.py:21` at *import* time, so `conftest.py` could not load and **the entire test
   suite failed to collect**.
2. `SUPABASE_SERVICE_ROLE_KEY` was still the **old** project's key.
3. Both `.env.local` files defined `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, but the code reads
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` — and `driver-pwa/lib/supabase.ts:6` falls back to
   `'placeholder-anon-key'`, so that one fails **silently**.

### 🔴 Stage-1 RLS baseline — record this number

Measured on the freshly migrated refactor DB, **before** any phase work:

```
pg_policies WHERE schemaname='public'          -> 45
pg_policies WHERE tablename='handshake_events' -> 3
```

The Stage-1 gate requires `phase_events` to carry **3** policies after the rename, and `relrowsecurity`
true. RLS breakage is silent — FastAPI connects as `service_role` and bypasses it — so this
before-number is the only thing that makes the after-number meaningful.

---

## Tasks

### 0.1 — Turn on the 133 skipped tests · 🔴 gates everything · **timebox: 1 day**

**Where:** `infrastructure/docker/docker-compose.test.yml` (create), `backend/.env.example`,
`backend/.env` (local, developer-applied), `.github/workflows/ci.yml`*
**Fence:** test infrastructure only. **No edits under `backend/app/`.** If a newly-live test fails,
it is a **pre-existing bug to record** in the Findings ledger below — not a thing to fix now. The
only exception is a failure caused by the harness itself (e.g. a fixture that cannot construct on a
clean database), which is in scope because it is infrastructure.

**0.1a — Create the test Postgres.** New opt-in compose file; `docker-compose.dev.yml` is a flagged
shared file and stays untouched, so the other three devs' stack is unchanged.

`infrastructure/docker/docker-compose.test.yml`:

```yaml
# FreightProof SA — throwaway Postgres for the backend integration test suite.
#
# Separate from docker-compose.dev.yml on purpose: the dev stack has no database
# (Supabase hosts it), and this container is destructive by nature — tests run
# Base.metadata.drop_all() against it at session teardown. Opt-in, not part of
# `up -d` for devs who aren't running DB tests.
#
# Port 5433 avoids colliding with any host Postgres on the default 5432.
# tmpfs storage means the data never survives a restart, which is the point:
# every run starts from an empty database, matching the CI service container.
#
# Start:  docker compose -f infrastructure/docker/docker-compose.test.yml up -d
# Stop:   docker compose -f infrastructure/docker/docker-compose.test.yml down

services:

  test-db:
    image: postgres:17-alpine
    container_name: freightproof-test-db
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: test
      POSTGRES_DB: freightproof_test
    # Ephemeral by design — no named volume, nothing to clean up or leak between runs.
    tmpfs:
      - /var/lib/postgresql/data
    healthcheck:
      test: [ "CMD-SHELL", "pg_isready -U postgres -d freightproof_test" ]
      interval: 5s
      timeout: 3s
      retries: 10
```

**0.1b — Document the key.** Append to `backend/.env.example`, after the `# Database` block:

```
# Throwaway Postgres for the integration suite — NOT a Supabase project.
# The suite runs Base.metadata.drop_all() against this URL at teardown.
# Start it with: docker compose -f infrastructure/docker/docker-compose.test.yml up -d
# Leave empty to skip the DB-backed tests.
TEST_DATABASE_URL=postgresql+asyncpg://postgres:test@localhost:5433/freightproof_test
```

> A real value rather than a bare key name is correct here: it is not a secret, and it must match
> `docker-compose.test.yml` exactly or every dev re-derives it wrong.

**0.1c — Add the same line to the local `backend/.env`.** Required because `config.py:118` reads the
file and the `conftest.py` `setdefault` fallback only fires when `.env` is *absent*. Appended without
reading the file:

```bash
printf '\nTEST_DATABASE_URL=postgresql+asyncpg://postgres:test@localhost:5433/freightproof_test\n' >> backend/.env
```

**0.1d — Give CI a database.** In `.github/workflows/ci.yml`, add a service container to the
`backend` job (between `runs-on:` and `steps:`) and the env var to the pytest step:

```yaml
  backend:
    name: Backend — lint, type-check, test
    runs-on: ubuntu-latest

    # Throwaway Postgres for the DB-backed suite. Isolated per workflow run, so
    # concurrent PRs can't drop each other's tables — the suite calls drop_all()
    # at teardown. Mirrors infrastructure/docker/docker-compose.test.yml.
    services:
      test-db:
        image: postgres:17-alpine
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: test
          POSTGRES_DB: freightproof_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres -d freightproof_test"
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10

    steps:
      # ... checkout / setup-python / cache / install / ruff / mypy unchanged ...

      - name: Test — pytest (excluding slow tests)
        working-directory: backend
        env:
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
          # Service containers are reachable on localhost from the job runner.
          # Port 5432 here, not 5433: the host-side mapping above is the runner's,
          # unrelated to the local compose file's collision-avoidance choice.
          TEST_DATABASE_URL: postgresql+asyncpg://postgres:test@localhost:5432/freightproof_test
        run: pytest -m "not slow"
```

**0.1e — Run and triage.** With the container up, run the suite and classify every failure into the
Findings ledger. Do not fix; record. Categories:
- **H** — harness/fixture defect (in scope to fix: it is test infrastructure)
- **P** — pre-existing product bug (record, ticket, move on)
- **R** — test asserts behaviour this refactor is about to delete (record; it dies in Stage 1–3)

---

### 0.2 — Add a driver-pwa CI job

**Where:** `.github/workflows/ci.yml`*
**Fence:** workflow only — no source changes in `frontend/driver-pwa/` to make it pass. If the job is
red on arrival, record it in the Findings ledger and decide with Tim (see risk note below); do not
start fixing his surface.

Scripts already exist (`lint`, `type-check`, `test` → `vitest run`) and a `package-lock.json` is
present. Only the workflow is missing. Append as a third job, mirroring `frontend`:

```yaml
  driver-pwa:
    name: Driver PWA — lint, type-check, test
    runs-on: ubuntu-latest

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Node 22
        uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
          cache-dependency-path: frontend/driver-pwa/package-lock.json

      - name: Install dependencies
        working-directory: frontend/driver-pwa
        run: npm ci

      - name: Lint — ESLint
        working-directory: frontend/driver-pwa
        run: npm run lint

      - name: Type-check — tsc
        working-directory: frontend/driver-pwa
        run: npx tsc --noEmit

      - name: Test — vitest
        working-directory: frontend/driver-pwa
        run: npm test
```

> ⚠️ **Verify green before this lands.** Stage 5 rewrites 95 driver-pwa files; a CI job that was
> already red gives Tim no signal. Run all three commands locally first (see Verification) and record
> the result. **If red:** land the job with the failing step(s) as a documented, separately-tracked
> follow-up rather than silently omitting them — a job that skips the broken check is worse than no
> job, because it reads as coverage.

> 📋 **Finding to record, not to act on:** `frontend/dispatcher` also has a `test` script (vitest) that
> CI never calls, and the parent plan's standard gate (§7) deliberately lists only `tsc --noEmit` and
> `npm run lint` for the dispatcher. Adding dispatcher tests to CI is **out of scope for Stage 0** —
> record it and raise it separately.

---

### 0.3 — Quantify what Tim's merged GPS work already gives P1

**Where:** read-only across `frontend/driver-pwa/lib/hooks/useLocation.ts`,
`frontend/driver-pwa/lib/hooks/__tests__/useLocation.test.ts`, plus the geofence-verdict and
trip-gating call sites that consume them.
**Fence:** **analysis only — no code, no edits, in any file.** Output is prose appended to this
document under *Findings — 0.3*.

Answer exactly three questions, because Tim needs the number before he commits to a Stage 5 date and
this may shrink Stage 5 materially:

1. Which parts of P1 activation (phone GPS capture, geofence verdict, assigned-trailer match) already
   exist and work post-PR #31?
2. Which of the 95 in-scope driver-pwa files are *only* touched by the H→P rename, versus those
   needing real logic change?
3. Does anything in the merged GPS work assume the fixed 1–5 handshake route, and therefore break
   under a plan-driven sequence?

---

### 0.4 — Freeze the contract

**Where:** `frontend/shared/lib/types/phase.ts` (create),
`frontend/shared/lib/constants/phase-meta.ts` (create),
`frontend/shared/lib/mocks/trips.ts` (rewrite to phase shape).
**Fence:** **Do not delete `handshake.ts` or `handshake-meta.ts` in this stage.** Both are still
imported by live dispatcher and driver-pwa code, and deleting them turns Stage 0 into Stage 4+5. They
are removed when their last consumer goes, in Stages 4 and 5. Add alongside; subtract later.
**Ownership:** D9 — these three files are Ciaran-only until this freeze ships.

**0.4a — `frontend/shared/lib/types/phase.ts`:**

```ts
// Phase: one entry in a trip's committed phase plan.
//
// The plan is DATA, generated at trip creation from the trip's stops and consignments —
// not a fixed list of six. A single-leg trip is the degenerate case of a multi-stop plan
// (7 rows); a three-stop cross-dock is 11. Nothing here may assume a length.
//
// Mirrors backend PhaseEventRead (schemas/phases.py) — parent plan §3.1.

export type PhaseEventId = string & { readonly __brand: 'PhaseEventId' }

// Mirrors backend PhaseType exactly — parent plan D5.
export type PhaseType =
  | 'trip_creation'
  | 'activation'
  | 'loading'
  | 'departure'
  | 'in_transit'
  | 'unloading'
  | 'confirmation'

// pending → in_progress → completed (happy path); exception and overridden are off-path.
export type PhaseStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'exception'
  | 'overridden'

// Parent plan D4. A phase can be `completed` while its anchor is `failed` — that
// combination is what makes the fail-open policy honest, so never render it as success.
export type AnchorStatus =
  | 'not_required'
  | 'pending'
  | 'anchored'
  | 'failed'

export interface PhaseDescriptor {
  phase_event_id: PhaseEventId
  trip_id: string
  phase_type: PhaseType

  // Null ONLY for trip_creation (parent D3). Every other phase is anchored to a stop —
  // in_transit anchors to the stop it DEPARTS FROM, so `in_transit` at stop 1 means
  // "the leg leaving stop 1".
  trip_stop_id: string | null
  stop_sequence: number | null

  // Position in the committed plan. NOT an enum index, NOT bounded by 6.
  sequence_number: number

  status: PhaseStatus
  anchor_status: AnchorStatus

  // Capture-component slugs for this phase type — see phase-meta.ts. Empty for
  // system-observed phases (trip_creation, loading).
  step_recipe: readonly string[]

  // ── Evidence, populated as the phase completes ────────────────────────────
  dispatcher_override_user_id: string | null
  dispatcher_override_note: string | null
  driver_phone_lat: number | null
  driver_phone_lng: number | null
  horse_gps_lat: number | null
  horse_gps_lng: number | null
  pulsit_geofence_confirmed: boolean | null

  // Captured at `departure` (P3), NOT at `loading` — parent D7/§2.6. Verified again
  // at `unloading` before the doors open.
  seal_number: string | null
  seal_photo_artifact_id: string | null
  waybill_photo_artifact_id: string | null
  gate_photo_artifact_id: string | null
  pod_photo_artifact_id: string | null

  // Present on the backend read schema (schemas/handshakes.py:153) but missing from the
  // old shared HandshakeEvent — a live contract drift. Carried across deliberately.
  pod_signature_artifact_id: string | null

  parcel_count_origin: number | null
  parcel_count_destination: number | null
  driver_visual_count: number | null

  event_hash: string | null
  blockchain_receipt_id: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

// A capture step within a phase, resolved from the phase's step_recipe.
// Keyed by phase-event id, not by a handshake number — the plan has no fixed indices.
export interface PhaseStep {
  phase_event_id: PhaseEventId
  stepIndex: number
  slug: string
  displayName: string
}
```

**0.4b — `frontend/shared/lib/constants/phase-meta.ts`:**

```ts
import type { PhaseType } from '@shared/lib/types/phase'

export const PHASE_NAMES: Record<PhaseType, string> = {
  trip_creation: 'Trip Created',
  activation: 'Activation',
  loading: 'Loading',
  departure: 'Departure',
  in_transit: 'In Transit',
  unloading: 'Unloading',
  confirmation: 'Confirmation',
}

// Driver-facing capture steps per phase TYPE — the recipe is static per type, while the
// number of times each type appears in a trip is data. Keyed by type rather than by an
// index precisely so a plan can contain `loading` twice.
//
// Empty recipe = no driver interaction:
//   trip_creation — dispatcher-side
//   loading       — system-observed via the Parcel Perfect poll; the driver never enters
//                   or sees a cargo count (F1), so a "match" can never be theatre.
export const STEP_SLUGS: Record<PhaseType, readonly string[]> = {
  trip_creation: [],
  activation: ['1-approach-gate', '2-verification'],
  loading: [],
  departure: ['1-approach-exit', '2-capture-seal', '3-waybill', '4-departure'],
  in_transit: ['1-arrival'],
  unloading: ['1-hand-waybill', '2-seal-verify', '3-seal-break-inspection', '4-visual-count'],
  confirmation: ['1-pod-photo', '2-pod-signature', '3-reconciliation', '4-closed'],
}

export const STEP_NAMES: Record<PhaseType, readonly string[]> = {
  trip_creation: [],
  activation: ['Gate Arrival', 'Verification'],
  loading: [],
  departure: ['Approach Exit Gate', 'Capture Seal', 'Photograph Waybill', 'Confirm Departure'],
  in_transit: ['Arrival'],
  unloading: ['Hand Waybill Copy', 'Verify Seal', 'Wait for Inspection', 'Visual Count'],
  confirmation: ['Photograph POD', 'Capture Signature', 'Reconciliation', 'Trip Closed'],
}
```

> 🔴 **The recipes above are a DRAFT to ratify with Tim in the 0.4 session, not a decision.** They are
> derived from the existing `HANDSHAKE_STEP_COUNTS`/`STEP_SLUGS` mapped through the H→P mapping
> (parent §2.5), with three substantive moves: seal capture from `loading` to `departure` (D7);
> `loading` losing all driver steps (F1); and old H4+H5 splitting across `unloading` and
> `confirmation`. Parent §10 lists step recipes as the last unspecified piece of the contract — this
> is the proposal that closes it.

**0.4c — Two contract questions to settle in the same session** (both change the shape above; neither
should be decided silently):

1. **Does `parcel_count_origin` belong on a descriptor served to the driver?** F1 says the driver must
   never see the expected count. One endpoint serves both surfaces, so either the field is omitted
   server-side by role, or the driver app is trusted not to render it. The first is correct; the
   second is cheaper. **This lands in Stage 3.2 either way — decide now, build then.**
2. **`step_recipe` on the wire, or looked up client-side from `phase_type`?** It is static per type,
   so sending it is redundant — but sending it means a recipe change ships without a client rebuild,
   which matters because driver-pwa is an installed APK. Recommend: **send it**.

**0.4d — `frontend/shared/lib/mocks/trips.ts` → phase shape.** This is what actually unblocks Tim.
Replace the `pendingHE` helper and the `HandshakeEvent[]` arrays with plan builders. The file must
export **both** canonical shapes, because the single-leg trip existing as the degenerate case of the
multi-stop plan is the thing the contract has to prove:

```ts
import type { PhaseDescriptor, PhaseEventId, PhaseType } from '@shared/lib/types/phase'
import { STEP_SLUGS } from '@shared/lib/constants/phase-meta'

const peId = (v: string): PhaseEventId => v as unknown as PhaseEventId

// Builds one pending descriptor. Every evidence field starts null — the ledger row exists
// from trip creation onward and is filled in as the phase completes.
function pendingPhase(
  id: string,
  tripId: string,
  phaseType: PhaseType,
  sequenceNumber: number,
  tripStopId: string | null,
  stopSequence: number | null,
  at: string,
): PhaseDescriptor {
  return {
    phase_event_id: peId(id),
    trip_id: tripId,
    phase_type: phaseType,
    trip_stop_id: tripStopId,
    stop_sequence: stopSequence,
    sequence_number: sequenceNumber,
    status: 'pending',
    anchor_status: phaseType === 'trip_creation' || phaseType === 'departure' || phaseType === 'confirmation'
      ? 'pending'
      : 'not_required',
    step_recipe: STEP_SLUGS[phaseType],
    dispatcher_override_user_id: null, dispatcher_override_note: null,
    driver_phone_lat: null, driver_phone_lng: null,
    horse_gps_lat: null, horse_gps_lng: null,
    pulsit_geofence_confirmed: null,
    seal_number: null, seal_photo_artifact_id: null,
    waybill_photo_artifact_id: null, gate_photo_artifact_id: null,
    pod_photo_artifact_id: null, pod_signature_artifact_id: null,
    parcel_count_origin: null, parcel_count_destination: null, driver_visual_count: null,
    event_hash: null, blockchain_receipt_id: null, completed_at: null,
    created_at: at, updated_at: at,
  }
}
```

The two canonical plans, matching parent §2.2 exactly:

| | Single-leg — 7 rows | Cross-dock (A:1→3, B:1→2, C:2→3) — 11 rows |
|---|---|---|
| 0 | `trip_creation` · stop NULL | `trip_creation` · stop NULL |
| 1 | `activation` · stop 1 | `activation` · stop 1 |
| 2 | `loading` · stop 1 | `loading` · stop 1 |
| 3 | `departure` · stop 1 | `departure` · stop 1 |
| 4 | `in_transit` · stop 1 | `in_transit` · stop 1 |
| 5 | `unloading` · stop 2 | `unloading` · stop 2 |
| 6 | `confirmation` · stop 2 | `loading` · stop 2 |
| 7 | | `departure` · stop 2 |
| 8 | | `in_transit` · stop 2 |
| 9 | | `unloading` · stop 3 |
| 10 | | `confirmation` · stop 3 |

The existing seven mock trips (`TRIP_0035` … `TRIP_0043`) convert mechanically: each old
`HandshakeEvent` maps to its phase per parent §2.5, and every trip gains the `in_transit` row it
never had. `TRIP_0035` should become the **cross-dock** example — the mocks must contain at least one
11-row plan or Tim builds against the fixed-length assumption all over again.

> **Contract fence:** if any part of the contract hard-codes "6 phases", "sequence 0..6", or a
> `Record<1|2|3|4|5, …>`, it is wrong. `HANDSHAKE_STEP_COUNTS` in `handshake-meta.ts:15-22` is that
> assumption in literal form — `phase-meta.ts` has no equivalent, and must not acquire one.

---

### 0.5 — Confirm the `main`/`dev` divergence plan

**Where:** decision recorded under *Findings — 0.5* in this document. **No code.**

`origin/revert-27-feature/gps-warehouse-geofencing` (`d95d772`) reverted PR #27 and **that revert is
in `origin/main`**; Tim's work re-landed on `dev` via PR #31. The eventual `dev → main` promotion will
conflict across exactly the files this refactor rewrites, and a careless resolution silently
re-reverts Tim's GPS work underneath the phase model.

Record two things and nothing else: **who owns the reconciling merge**, and **which date it happens**
— before this refactor promotes, not at presentation time.

---

## Tests to write

Stage 0 writes **no new product tests** — it makes 133 existing ones executable, which is the point.
Two infrastructure assertions are worth having, and both are cheap:

| Test | Proves | Where |
|---|---|---|
| A CI run on this branch shows `pytest` reporting **≥ 300 passed** and a skip count matching the recorded floor | The service container is actually reached, and CI is not silently skipping the same 133 | observed in the Actions log, not asserted in code |
| `npx tsc --noEmit` in **both** `frontend/dispatcher` and `frontend/driver-pwa` after `phase.ts`/`phase-meta.ts` land | The new shared types compile and import cleanly from both apps via `@shared/*` — the actual Tim-Gate condition | Verification below |

Do not write tests for `phase.ts` — it is types only, and `tsc` is the test.

---

## Out of scope

| Excluded | Why |
|---|---|
| Everything under `backend/app/` | 0.1's fence. Stage 0 changes no product code. |
| `backend/app/core/config.py` | `TEST_DATABASE_URL` already exists at `:21`. Flagged shared file stays untouched. |
| `infrastructure/docker/docker-compose.dev.yml` | Flagged shared file; the test DB goes in its own opt-in file so the other three devs' stack is unchanged. |
| Deleting `handshake.ts` / `handshake-meta.ts` | Still imported by live dispatcher and driver-pwa code. They die in Stages 4 and 5. |
| Fixing whatever the newly-live tests reveal | Parent §6.3 protection #1: record and move on, or Stage 0.1 eats the critical path. |
| Adding a `test` step to the dispatcher CI job | Real gap, but the parent's standard gate deliberately excludes it. Record, raise separately. |
| `backend/test_db.py` | Stray debug script at the backend root (prints users/orgs from `DATABASE_URL`). Not collected by pytest (`testpaths = tests`). Record; don't tidy on this branch. |
| Any Alembic migration | Stage 1. The test DB uses `create_all`, never migrations. |
| Driver-pwa source changes | Tim's surface. 0.2 adds the CI job; 0.3 is read-only. |

---

## Verification

Run in order. Every command's expected output is stated — a command whose output you did not read has
not been run.

**1 — Test database up:**
```bash
docker compose -f infrastructure/docker/docker-compose.test.yml up -d
docker compose -f infrastructure/docker/docker-compose.test.yml ps
```
Expect `freightproof-test-db` with status `Up` and `(healthy)`.

**2 — The skips are gone (the whole point of 0.1):**
```bash
cd backend && .venv/bin/python -m pytest -q
```
Expect passed **≫ 187** and skipped **≪ 133**. Baseline for comparison: `187 passed, 133 skipped`.
Any test that neither passes nor skips goes in the Findings ledger.

**3 — Confirm nothing is skipping for the old reason:**
```bash
cd backend && .venv/bin/python -m pytest -q -rs 2>&1 | grep -c "TEST_DATABASE_URL not set"
```
Expect `0`.

**4 — Standard gate, backend:**
```bash
cd backend && .venv/bin/ruff check . && .venv/bin/mypy .
```
Expect `All checks passed!` and `Success: no issues found in 152 source files` (the file count rises
only if Stage 0 adds Python files — it should not).

**5 — Standard gate, dispatcher** (proves the new shared types import cleanly):
```bash
cd frontend/dispatcher && npx tsc --noEmit && npm run lint
```
Expect no output from `tsc`, and lint clean.

**6 — Standard gate, driver-pwa** (0.2's precondition — run *before* landing the CI job):
```bash
cd frontend/driver-pwa && npm run type-check && npm run lint && npm test
```
Expect all three green. **If not, record in Findings and see the 0.2 risk note — do not fix Tim's
surface.**

**7 — CI is genuinely exercising the database.** Push the branch and read the Actions log for the
`backend` job. Expect the pytest step's summary line to match step 2's local numbers. A green job
with `133 skipped` means the service container was never reached and 0.1 has failed silently — this
is the one failure mode of this stage that looks like success.

---

## Done when

**The Tim Gate (parent §6.2) is fully open**, evidenced by all five:

- [ ] `phase.ts` frozen, compiling, importable from both apps
- [ ] `phase-meta.ts` frozen, step recipes agreed with Tim
- [ ] `mocks/trips.ts` in phase shape, including at least one 11-row cross-dock plan
- [ ] driver-pwa CI job live
- [ ] Stage 5 re-scoped with Tim against 95 files, informed by 0.3

…and the skip floor is recorded below. **That number is the floor every later stage must not exceed**
(parent §9).

> **Suggested commits** (Ciaran runs git; this plan never does):
> - `test(backend): run DB-backed suite against a throwaway Postgres`
> - `ci: add driver-pwa lint/type-check/test job`
> - `feat(shared): frozen phase contract types, meta and mocks`

---

## Findings ledger

*Filled in during execution. This section is the stage's real output — the parent plan's §9 tripwire
depends on the skip floor being written down.*

### 0.1 — Skip floor · **executed 2026-07-27**

| Metric | Before | After |
|---|---|---|
| Passed | 187 | **250** |
| Skipped | 133 | **0** ← the floor is now zero |
| Failed | 0 | **70** |

**The skip floor is 0.** No later stage may reintroduce a skip. All 320 collected tests execute.

**The headline result — the refactor surface now has a net:**

```
pytest tests/unit/test_handshake_service.py tests/unit/test_handshake_anchor_payload.py \
       tests/unit/test_verification_service.py tests/unit/test_anchor_service.py
→ 24 passed in 1.66s
```

Every state-machine test that Stage 2 will rewrite `advance_h1..h5` against now runs **and passes**.
That was the entire purpose of this task, and it is achieved.

### 0.1 — 🔴 Finding F1: the suite contains two incompatible auth conventions

The 70 failures are not 70 bugs. The integration suite is split down the middle, and **no value of
`DEMO_MODE` makes it green**:

| `DEMO_MODE` | Passed | Failed | Who fails |
|---|---|---|---|
| `false` (config default, and the **locked** posture per parent §5.5) | 250 | **70** | the 11 `Bearer demo` files |
| `true` | 283 | **37** | the 11 `make_token` files |

```
Files authenticating with the DEMO_MODE stub ("Bearer demo") — 11:
  test_blockchain_verify, test_create_trip_multistop, test_drivers, test_drivers_anchor,
  test_precincts, test_trips, test_trips_anchor, test_vehicles, test_vehicles_anchor,
  test_vehicles_cosmetic_diff, test_vehicles_validation

Files authenticating with real signed JWTs (make_token) — 11:
  test_artifacts, test_auth_router, test_checkpoints, test_drivers_me, test_exception_scoping,
  test_exceptions, test_handshakes, test_handshakes_anchor, test_manifest, test_pp_endpoints,
  test_trips_driver_active

Files using both: NONE
```

The `Bearer demo` half seeds against the hardcoded `_DEMO_ORG_ID` /`_DEMO_USER_ID`
(`app/auth/dependencies.py:43-44`) and only authenticates when the stub at `:199` is active. The
`make_token` half seeds random orgs and signs real ES256 tokens; under `DEMO_MODE=true` the stub
overrides the token identity, the org no longer matches, and every lookup 404s.

**Why this is a locked-decision problem, not just a test problem.** Parent §5.5 step 5 fixes the
system on **real Supabase Auth, not `DEMO_MODE`**. Under that posture the 11 `Bearer demo` files test
an auth mode the system no longer runs in — they must be converted to `make_token` regardless of this
refactor. Class **H**, but it is a day of work on its own, and Stage 0.1 is timeboxed to one day.

### 0.1 — Finding F2: 12 genuine, auth-independent failures

Failing under **both** `DEMO_MODE` values, so unrelated to F1:

| # | Test | Class | Cause |
|---|---|---|---|
| 1–4 | `test_vehicles.py::test_create_vehicle_returns_201`, `::test_create_vehicle_appears_in_subsequent_list`, `test_vehicles_validation.py::test_create_vehicle_valid_vin_returns_201`, `::test_update_vehicle_valid_vin_returns_200` | **P** | `ForeignKeyViolationError: vehicle_events_changed_by_user_id_fkey` — fixtures seed an Organization but no `User` row, so the audit-event write fails. **Only reproducible on a clean database**, which is precisely why it was never seen: the shared dev DB always had that user. |
| 5 | `test_vehicles_validation.py::test_update_vehicle_invalid_vin_leaves_db_state_unchanged` | **P** | `sqlalchemy.exc.MissingGreenlet` — lazy-load attempted outside the async context. Same family as the known `ConsignmentRead` lazy-load issue. |
| 6–7 | `test_drivers.py::test_create_driver_returns_201_with_pending_status`, `::test_create_driver_appears_in_subsequent_list` | **P** | `assert 409 == 201` — duplicate-resource collision; fixture isolation on a unique column. |
| 8 | `test_drivers_anchor.py::test_create_driver_does_not_anchor_pii` | **P** | `license_number SHA-256 hash not found in blockchain receipt` — a real POPIA-adjacent assertion. **Worth reading properly before dismissing.** |
| 9 | `test_trips.py::test_create_trip_response_shape` | **P** | response contains rows where `[]` expected. |
| 10 | `test_vehicles_cosmetic_diff.py::test_mixed_patch_anchors_only_critical_field` | **P** | `assert 422 == 200`. |
| 11 | `test_blockchain_verify.py::test_verify_returns_no_receipt_for_unknown_subject` | **P** | `assert 404 == 200`. |
| 12 | `test_handshakes_anchor.py::test_h2_complete_hedera_timeout_returns_504_and_trip_unchanged` | **R** | Asserts the fail-**closed** 504 behaviour that parent §7 Stage 2.5/3.1 deliberately **deletes** in the fail-open switch. Expect this to be rewritten, not fixed. |

### 0.1 — 🔴 Finding F3: unmocked Hedera network calls in the test suite

`tests/integration/test_create_trip_multistop.py` (6 tests) **does not patch `HederaService`** —
trip creation is fail-closed P0 anchoring, so these make real Hedera **testnet** calls:

```
8.03s  test_single_leg_create_synthesises_two_stops
5.74s  test_multi_stop_create_persists_stops_in_order
6.71s  test_trips.py::test_create_trip_writes_trip_to_db
```

Whole-suite runtime is **7.8s** when auth fails early vs **111s** when it doesn't. `test_artifacts.py`
also has no patch. `test_drivers_anchor`, `test_vehicles_anchor`, `test_trips_anchor` and
`test_handshakes_anchor` **do** patch it correctly — the pattern exists, it just isn't applied
everywhere.

**CI consequence:** every PR would hit Hedera testnet, needing real `HEDERA_ACCOUNT_ID` /
`HEDERA_PRIVATE_KEY` / `HEDERA_TOPIC_ID` secrets and inheriting testnet flakiness and latency. Fixing
this is small (mirror the existing `patch("app.blockchain.anchor_service.HederaService")`) and pays
for itself immediately, but it is **product-adjacent test code and outside 0.1's fence** — record and
schedule.

### 0.1 — Decisions taken during execution (2026-07-27, Ciaran)

**DE1 — F1 (auth split): leave CI red, convert the 11 stub files in Stage 1.5.**
CI does not run on `Phase-refactor` at all — `.github/workflows/ci.yml` triggers on
`pull_request → dev|main` and `push → dev` only — so a red suite costs nothing until the refactor
opens its PR against `dev`, which is post-Stage-3. Stage 1.5 already rewrites `seed_demo.py` to
provision real Supabase Auth users, so converting the stub files to `make_token` belongs in the same
change rather than duplicating the real-auth setup twice. Quarantining behind a pytest marker was
rejected: it would recreate under another name the exact thing 0.1 just removed — tests that exist
but never execute — and would make the recorded skip floor of 0 misleading.

> **Added to Stage 1.5 scope:** convert these 11 files from `Bearer demo` / `_DEMO_ORG_ID` to
> `make_token` + real seeded `User`/`Organization` rows —
> `test_blockchain_verify`, `test_create_trip_multistop`, `test_drivers`, `test_drivers_anchor`,
> `test_precincts`, `test_trips`, `test_trips_anchor`, `test_vehicles`, `test_vehicles_anchor`,
> `test_vehicles_cosmetic_diff`, `test_vehicles_validation`. **~58 tests. Budget one day.**
> Fixing F2 items 1–4 falls out of this for free: the `vehicle_events_changed_by_user_id_fkey`
> violations are exactly a missing seeded `User` row.

**DE2 — F3 (unmocked Hedera): record and schedule, do not patch now.**
Keeps 0.1 strictly within its fence. **Hard dependency to remember: CI cannot go green until this is
done**, because no Hedera secrets are configured in the workflow and those tests will fail on missing
config even after the auth conversion. Schedule alongside DE1 in Stage 1.5, or earlier if the local
111s suite runtime becomes annoying.

### 0.1 — Finding F4: minor

- `backend/test_db.py` — stray debug script at the backend root that connects to `DATABASE_URL` and
  prints users/organizations. Not collected (`testpaths = tests`). Delete on a tidy-up branch, not
  this one.
- `frontend/dispatcher` has a `test` script (vitest) that CI never calls. Parent §7's standard gate
  omits it deliberately; raise separately.
- **`frontend/driver-pwa/tsconfig.tsbuildinfo` is git-tracked** but is a build artifact — running
  `npm run type-check` dirties the working tree for every dev. `eslint.config.mjs` already ignores it;
  `.gitignore` does not. One-line fix, but it is Tim's surface — raise with him, don't take it here.
- **`npm run lint` on driver-pwa is extremely slow** (>14 min locally on a cold cache; `tsc --noEmit`
  is similar). The config is not at fault — `.next/`, `out/`, `node_modules/`, `android/`, `ios/` are
  all correctly ignored. Budget for it in CI job timings, and expect the driver-pwa job to dominate
  wall-clock on every PR.

### 0.2 — driver-pwa gate on arrival · **RED, pre-existing, unrelated to this refactor**

**Root cause of the earlier confusion: the local `node_modules` was stale.** `clsx`,
`class-variance-authority`, `tailwind-merge`, `@radix-ui/*` and `tailwindcss-animate` were all
declared in `package.json` but **not installed**, which is what made eslint and vitest hang and
produced a wall of phantom `Cannot find module` errors. `npm ci` resolved it. **CI is unaffected —
`npm ci` installs from the lockfile, so this was purely a local-environment defect.**

> ⚠️ Method note worth remembering: an earlier reading of "type-check green, exit 0" was wrong. The
> command was `npm run type-check 2>&1 | tail -15`, and a pipeline's exit status is `tail`'s, not
> `tsc`'s. **Never read an exit code through a pipe.** Corrected below.

| Command | Result (deps installed) |
|---|---|
| `npm run lint` | ✅ **clean** — no output, and fast. The 23-minute "hang" was the broken install. |
| `npm test` (vitest) | ✅ **57 files, 351 tests, all passing, 9.53s** |
| `npm run type-check` | 🔴 **2 errors — both pre-existing, both in test files** |

```
components/trip/__tests__/TripDetailView.test.tsx(40,3): error TS2739:
  ... is missing the following properties from type 'Trip': trip_type, consignments, warnings
lib/utils/__tests__/trip-filters.test.ts(10,3): error TS2322:
  Types of property 'trip_type' are incompatible. Type 'undefined' is not assignable to 'TripType'.
```

**Neither error involves the phase contract.** Both are drift from the trip-creation redesign, which
added `trip_type`, `consignments` and `warnings` to `Trip` without updating these two driver-pwa test
fixtures. **This is exactly the class of regression Stage 0.2 exists to catch** — driver-pwa has had
no CI, so the drift sat unnoticed. Two fixture updates, roughly ten minutes.

🔴 **Consequence:** the CI job is landed and **2 of its 3 steps pass**. The type-check step will be
red on its first run. Per this plan's own 0.2 guidance that is recorded rather than papered over —
do not remove the failing step. **Owner: Tim**, as part of opening the Tim Gate; it is his surface
and the fix is two fixture updates.

**Revised verdict: the driver-pwa CI job is sound, not provisional.** Lint and vitest are genuinely
green and fast (9.5s for 351 tests), so Stage 5's inner loop is fine — the earlier concern about a
20-minute lint was an artifact of the broken local install, not a real property of the project.

### 0.3 — What Tim's GPS work already gives P1

**Q1 — what already exists for P1 activation?** `lib/hooks/useLocation.ts` (152 lines) is complete and
**entirely phase-agnostic**: typed `LocationCoords`, a four-way `LocationErrorReason` discriminator so
the UI can distinguish "retry is useless" (`permission_denied`) from "retry is right"
(`timeout`/`position_unavailable`), Capacitor + web paths, and a dev-only Linbro Park fallback gated
on `NODE_ENV === 'development'` with a well-argued comment about why a fabricated coordinate is the
worst defect this app could ship. `components/handshake/GpsCapture.tsx` wraps it and is equally
generic. **Neither needs any change for P1** — they are already "capture components stay generic,
only the sequence becomes data" (parent §2.6).

**Q2 — rename-only vs real logic change?** The fixed 1–5 assumption is **concentrated in 6 named
sites, not diffuse across 95 files**:

| Site | The assumption |
|---|---|
| `app/(app)/trip/handshake/[h]/step/[slug]/` | the `[h]` 1–5 URL segment itself |
| `lib/utils/handshake-progress.ts:12,13,39` | `Record<1\|2\|3\|4\|5, HandshakeStageState>` ×3 |
| `lib/hooks/useStepIndicator.ts:5,21` | `HANDSHAKE_STEP_COUNTS[handshake]` |
| `components/trip/HandshakeProgressBar.tsx:7` | same fixed `Record` type |
| `lib/constants/routes.ts:2` | URL builder for `/trip/handshake/[h]/step/[n]-[slug]` |
| `components/handshake/StepHeader.tsx:20` | reads `STEP_NAMES`/`HANDSHAKE_STEP_COUNTS` |

**This is the number Tim needs: the 95-file count is real, but the great majority is mechanical
rename behind the descriptor indirection.** The genuine logic work is these six sites plus the
route restructure. Stage 5 is very likely smaller than the file count implies — confirm with Tim
before he commits to a date.

**Q3 — does the merged GPS work break under a plan-driven sequence?** No. `useLocation` and
`GpsCapture` take no handshake number and read no fixed-length constant. The coupling lives entirely
in the routing/progress layer listed above, not in the capture layer.

### 0.4 — Contract frozen (types + meta + mocks)

**Landed additively — no existing file touched.** Verified first that `mocks/trips.ts` has **14
consumers** across both apps and `Trip.handshakes` has **6**, so rewriting it in place (as this plan
originally specified) would have broken both builds immediately. Corrected to new files only; the
handshake-shaped mocks die with their last consumer in Stages 4 and 5.

| File | Status |
|---|---|
| `frontend/shared/lib/types/phase.ts` | **new** — `PhaseType`, `PhaseStatus`, `AnchorStatus`, `CoarseTripStatus`, `PhaseDescriptor`, `PhaseStep`, `TripWithPhases` |
| `frontend/shared/lib/constants/phase-meta.ts` | **new** — `PHASE_NAMES`, `STEP_SLUGS`, `STEP_NAMES`, `ANCHORED_PHASES`, all keyed by `PhaseType` |
| `frontend/shared/lib/mocks/phase-trips.ts` | **new** — `makePhasePlan()` generator + the two canonical plans |

**No fixed-length construct anywhere:** every record is keyed by `PhaseType`, never by a numeric
union. `sequence_number` is a plain `number`. `TripWithPhases` carries `current_phase`/`current_stop`
documented explicitly as caches that no write path may branch on.

**`makePhasePlan()` implements the §2.2 generation rule and its output was executed and verified**,
not eyeballed — it reproduces both reference plans exactly:

```
SINGLE LEG (7 rows)                CROSS DOCK (11 rows)
seq 0  trip_creation  stop=NULL    seq 0  trip_creation  stop=NULL
seq 1  activation     stop=1       seq 1  activation     stop=1
seq 2  loading        stop=1       seq 2  loading        stop=1
seq 3  departure      stop=1       seq 3  departure      stop=1
seq 4  in_transit     stop=1       seq 4  in_transit     stop=1
seq 5  unloading      stop=2       seq 5  unloading      stop=2
seq 6  confirmation   stop=2       seq 6  loading        stop=2
                                   seq 7  departure      stop=2
                                   seq 8  in_transit     stop=2
                                   seq 9  unloading      stop=3
                                   seq 10 confirmation   stop=3
```

This generator is **executable documentation of the algorithm Stage 2.1 implements in
`orchestration/trip_service.py`** — port the rule, then assert the Python emits these same two plans.

**Compile check:** `npx tsc --noEmit` in `frontend/dispatcher` → **exit 0**. Both tsconfigs include
`../shared/**/*.ts`, so the new files are genuinely type-checked rather than merely present.
driver-pwa verification is blocked on its broken local install (see the 0.2 correction).

🔴 **Still requires Tim before this counts as *frozen* rather than *drafted*:** the step recipes in
`phase-meta.ts` are a proposal (parent §10 open item 1), and the two contract questions in task 0.4c
— whether `parcel_count_origin` should be omitted server-side by role, and whether `step_recipe`
ships on the wire — are unanswered.

### 0.5 — `main`/`dev` divergence

*(owner + date)*
