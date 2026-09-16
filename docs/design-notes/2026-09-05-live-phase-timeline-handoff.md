# Live sub-phase timeline — session handoff

> **2026-09-08 geofence update:** The “real columns nothing writes” entry below is
> superseded for Pulsit/geofence fields. Current phase/checkpoint corroboration writes
> tracker coordinates and verdicts; verify current source before implementing from this handoff.
>
> **Author:** Ciaran · **Date:** 2026-09-05 · **Status:** handoff, work not started
> **Purpose:** this is the entry point for a fresh session. It exists because the reasoning
> that protects this codebase lives in conversation, not in code, and a session that starts
> cold will delete things it should not. Read §5 before touching anything.
> Every claim carries the command that re-checks it. Line numbers move — match on content.
> **Implementation authority:**
> [2026-09-02-step-event-ledger-implementation-plan.md](2026-09-02-step-event-ledger-implementation-plan.md),
> incorporating the 2026-09-05 correction review on 2026-09-06.

## 0 · What is being built

**In the requester's words:** *"each event to happen live as the trip happens with time
stamps as the phases get completed live — one grain smaller."*

Translated: the trip detail timeline currently renders **one row per phase**. The goal is
rows **inside** each phase card — the acts that made the phase happen — appearing live with
their own timestamps, so a dispatcher watching a live trip sees what is happening now rather
than what completed last.

This is not a new screen. The rail already exists and already carries act rows: exceptions
were moved onto it on 2026-09-04 (`76afa19`). This adds evidence-capture acts beside them.

## 1 · Read first, in order

1. **`CLAUDE.md`** — standards, layering, the git rules. Non-negotiable.
2. **This document**, entirely, especially §5.
3. [`2026-09-02-step-event-ledger-implementation-plan.md`](2026-09-02-step-event-ledger-implementation-plan.md)
   — §0 (the three answers), §5 (Stage 0), §6 Stages 1/2/4, §8 (open decisions).
4. [`2026-09-04-exception-queue-scaling.md`](2026-09-04-exception-queue-scaling.md) — the
   realtime refetch strategy, which §9.4 of the parent note requires settled *before* a live
   rail ships.
5. `graphify-out/GRAPH_REPORT.md` before any cross-file question. Do not grep the repo first.

## 2 · Where the code stood at handoff

Snapshot from 2026-09-05: seven commits ahead of `origin/dev` on branch `Ciaran`, tree
clean, all suites green. Re-run §6 rather than treating these counts as current:

```
c9b15e7  docs: design note + alembic autogenerate issue
1599d3f  docs: scaling plan and sprint 6 amendments
027a4a0  chore(shared): remove dead mocks and guard scaffold
76afa19  refactor(dispatcher): exceptions as timeline act rows   ← the rail pattern
7d8e057  feat(api): dispatcher exception list and resolve (FP-146)
4b5512c  feat(dispatcher): rank alert stream on severity (FP-148A)
a1037d8  feat(orchestration): live events from system exceptions (FP-147)
```

**Already banked, and directly relevant:**

- **The act-row rail exists.** `TimelineEvent` renders exceptions as sibling rows with
  `nodeType="warn"`, gated by `ownsExceptionRows` so in-transit legs do not double-render.
  `trailingExcCount` keeps the rail connector correct when rows follow a phase.
- **`alwaysExpandedContent`** — the prop the new rows should use — exists at
  `page.tsx:152`, rendered at `:285`, already in use at `:798`.
- **The realtime channel carries `severity`.** Ranking lives in
  `lib/realtime/ranking.ts`, a pure module. **Any new kind that rides this channel purely to
  trigger a refetch must publish at `INFO`**, or it raises a sticky red alarm on every
  dispatcher's screen. See D-11's amendment in the ledger plan.

## 3 · The recorded call: bounded rail first, full ledger second

There are two ways to build this and they differ by an order of magnitude. The authoritative
plan now decides the release boundary: Path A in Iteration 3, Path B in Iteration 4.

### Path A — attributed capture-event rail (no `phase_steps` table)

Surface evidence-producing acts under each phase card. This is S0.3–S0.4 in the ledger plan
and is the approved Iteration 3 slice.

`captured_at` and `created_at` already flow to the dispatcher, but only inside artifact
details behind a chevron:

```bash
grep -rn "captured_at" frontend/dispatcher frontend/shared/lib/types/evidence.ts \
  backend/app/schemas/evidence.py --exclude-dir=node_modules --exclude-dir=.next
```

| Where | State |
|---|---|
| `db/models/evidence.py:46` | `nullable=False` — always populated |
| `api/v1/endpoints/artifacts.py:37` | collected on upload as a form field |
| `orchestration/artifact_service.py:94` | **already ordered by it** |
| `schemas/evidence.py:21,42` → `types/evidence.ts` | client capture and server receipt are already on the wire |
| `EvidencePhoto.tsx:28`, `EvidenceDocument.tsx:29` | rendered — but *inside* each artifact, behind a chevron |

Use `captured_at` as the event time and show `created_at` as “received” when it differs. That
distinction makes a delayed offline upload visible instead of pretending client capture and
server receipt happened together.

Re-presentation alone works only after phase completion, when phase-row artifact FKs exist.
For the live window, add nullable `phase_event_id` and `step_slug` to
`evidence_artifacts`, populate both from the five evidence-producing driver steps, validate
them on upload, enforce their all-or-neither shape with a database check, and refetch the
separate artifacts endpoint when an INFO upload event arrives. This is a small migration and
backend change, but still far smaller than Path B.

The completion path must also validate attribution. Extend the current same-trip artifact
guard so an attributed artifact matches the phase being completed and the expected slug for
the completion field. Continue accepting unattributed artifacts from older queued clients;
reject only attributed rows that claim the wrong phase or step. Retakes remain append-only,
and the artifact ID supplied at completion is the copy of record.

For upload validation, “active” means the trip's current eligible unresolved phase with
status `PENDING` or `IN_PROGRESS`; do not require `IN_PROGRESS` alone, because current code
does not set it.

The five current producers are loading linehaul, departure seal, unloading intact seal,
confirmation POD photo and confirmation POD signature. There is no current live departure
waybill-photo producer, although an older queued departure may still upload one through the
legacy compatibility path.

### Path B — the step-event ledger (Stages 1 → 2 → 4)

A real `phase_steps` table with `actor_type`, `sequence_number`, `occurred_at` /
`recorded_at`, `event_hash`, `idempotency_key`. Stage 4 is **blocked on Stages 1–2, not on
Stage 3** — the Merkle/anchoring work is not on this path.

### The boundary that decides it

**Path A can only timestamp steps that captured evidence.** A step that produces no artifact
— "trip adopted", "activation attested" — has no timestamp source without the ledger. If the
requirement is *every* step timestamped, Path A cannot deliver it and Path B is the answer.

**Decision: Path A in Iteration 3; Path B in Iteration 4.** Path A delivers the visible live
slice and answers the density question without introducing the full ledger table. Build it
on `app/dev/design/page.tsx` first with the 11-phase case, then the real page. Describe it as
the **capture-event rail**, not “every step live.”

## 4 · Suggested order

```
A → B          emit invariant, then kind-filtered subscription
               (see 2026-09-04-exception-queue-scaling.md)
S0.3           hand-written attribution migration + typed five-producer catalogue
S0.3           upload validation + completion-time attribution validation
S0.3           capture-event rail on dev/design first, then the real page
S0.4           INFO upload event + kind-filtered artifact refetch
─────────────  Iteration 3 boundary: density case proven; D-8 decided
FP-167         phase_service.py split (Stage 2 preparation)
Stage 1 → 2 → 4                                                            ← Path B
D-9 + D-12 → Stage 3   versioned payload + corrected pre-anchor materialisation
Stage 5        only after queue replay and prerequisite failures are distinguishable
```

## 5 · Traps — read this before deleting anything

### 5.1 · Code that looks dead and is deliberately kept

**Do not delete or make required.** Each survives for a stated reason:

| Thing | Why it stays |
|---|---|
| `guard_verified_seal`, `seal_number_confirmed` (`schemas/phases.py`, `phase_service.py`) | No client sends them; the driver app dropped them 2026-08-05. **The offline queue treats a 4xx as terminal and DISCARDS the entry**, so making them required or deleting them permanently strands queued departures carrying valid evidence. The `Optional[bool]` tri-state is load-bearing: `None` = "not collected" and is the normal case; a falsy check stamps a CRITICAL `seal_mismatch` on every trip. Four tests hold the line at `test_phase_service.py:705-790`. Reasoning is at `driver-pwa/lib/api/phases.ts:50`. |
| `waybill_photo_artifact_id` | No current live step captures it, but an older queued departure may still upload and attach it. Keep the compatibility path. |
| The `enqueue_event` in the dead seal-mismatch branch of `advance_departure` | Deliberately emitted, deliberately untested. The comment explains why. Verified accurate 2026-09-04. |
| `pulsit_geofence_confirmed`, `horse_gps_lat/lng`, `Parcel.pp_scan_out_at/pp_scan_in_at`, `GPS_TOLERANCE_METRES`, `sla_configs` | Real columns nothing writes. Tracked on **FP-143, FP-68, FP-159** — other people's tickets. Out of scope. |

**`pulsit_geofence_confirmed` matters to this work specifically.** A "Pulsit position ·
inside geofence" row — an independent system corroborating the driver's claim — is the most
valuable row such a rail could show, and it cannot be built here. That column is FP-143/FP-68.

### 5.2 · `alembic --autogenerate` will propose dropping 17 indexes and both auth FKs

See `docs/known-issues.md` §5. Autogenerate proposes `DROP INDEX` on 17 indexes plus
`fk_users_auth_id` / `fk_drivers_auth_id` into Supabase's `auth` schema, because those
objects are created by earlier migrations but not declared on the models. **Hand-write
migrations. Scope them to the intended change by hand.**

`git fetch origin` and check for unmerged migrations on `dev` before generating anything —
28 revisions on disk. Name yours `2026_MM_DD_ciaran_<what>.py`.

**The requester runs Alembic themselves. Write migrations; do not execute them.**

### 5.3 · A bare `pytest` reports false green

`backend/tests/conftest.py:190-191` skips **every DB-backed test** unless
`TEST_DATABASE_URL` is set in `backend/.env`. A bare `pytest -q` then reports all-pass while
the integration half never ran.

**Always pass `-ra` and read the skip reasons. Four skips is correct** — deliberate
parametrised cases in `test_seed_fixtures.py`. A large skip count means "green" is meaningless.

### 5.4 · The frozen test contract (Path B only)

The 32 phase-touching backend test files (~15,895 lines) must stay green **and unmodified**
through Stages 1–3. A test needing an edit is the signal a contract moved. Capture the
baseline first:

```bash
cd backend && pytest -q --tb=no > /tmp/baseline.txt
git diff --stat backend/tests/     # must stay empty
```

Three contracts must not move: the offline queue's shape, the anchoring path, and the
completion endpoints' contract.

### 5.5 · Prove a TS file is unreferenced with the compiler, not with grep

On 2026-09-04 a `grep` for `mockExceptions` / `mocks/exceptions` reported zero importers.
It missed `mocks/index.ts`, which re-exported it as `export * from './exceptions'` —
matching neither pattern. `tsc --noEmit` caught it. Use the compiler.

### 5.6 · Upload attribution alone does not protect phase completion

`_assert_artifacts_belong_to_trip` currently proves only that every cited artifact belongs to
the trip. After Path A adds attribution, completion must also check the expected
`(phase_event_id, step_slug)` for each evidence field. Without that second guard, a departure
seal image can be supplied as POD evidence on the same trip and still pass ownership.

Keep the compatibility branch explicit: an unattributed artifact may come from an older
queued client and remains valid; an attributed artifact must match. Test both branches.

## 6 · Baseline — establish before changing anything

```bash
source backend/.venv/bin/activate && cd backend && pytest -q -ra
cd frontend/dispatcher && npm test && npx tsc --noEmit && npm run lint
cd frontend/driver-pwa  && npm test && npx tsc --noEmit && npm run lint
cd backend && mypy --config-file mypy.ini app && ruff check app/
```

**Expected as of 2026-09-05, all verified:**

| Check | Expected |
|---|---|
| backend `pytest -q -ra` | **958 passed, 4 skipped** (the 4 are deliberate) |
| dispatcher `npm test` | **279 passed, 24 files** |
| driver-pwa `npm test` | **696 passed, 82 files** |
| `mypy` | clean, 101 source files |
| `ruff`, `tsc --noEmit` ×2 | clean |
| `npm run lint` ×2 | 0 errors (2 pre-existing `<img>` warnings in `EvidencePhoto.tsx`) |

If a stale `.next` produces a runtime error like `undefined is not an object (evaluating
'e.useCache')`, that is a poisoned incremental build, not source:
`rm -rf .next && npm run dev`.

## 7 · Open decisions

- **D-8 · How does a derived row read?** Path B only, but **take it before Stage 2**. Derived
  steps have no honest `occurred_at` unless an artifact supplies one. Recommendation in the
  ledger plan: nullable `occurred_at` plus an explicit derivation marker, rendered distinctly
  from §9.3's dashed "not yet happened" row. *"The difference between a ledger and a
  ledger-shaped table."*
- **D-10 · Are exceptions act rows?** ✅ Decided yes, shipped `76afa19`.
- **D-11 · Where does severity gating live?** ✅ Decided, **not as originally recommended** —
  see the amendment in the ledger plan §8.
- **D-12 · Where are anchored-phase children materialised?** Path B only. Departure and
  confirmation anchor before `_finish_phase`, so Stage 3 needs the pre-anchor/idempotent
  materialisation decision recorded in the authoritative plan.

## 8 · Shared files — coordinate before changing

Per `CLAUDE.md`: `backend/app/main.py`, `core/config.py`, `db/models/__init__.py`,
`requirements.txt`, both `package.json`, `docker-compose.dev.yml`, `CLAUDE.md`.

For this work specifically:

| File | Path | Note |
|---|---|---|
| `core/realtime.py` | S0.4 | Three tickets, one file. Coordinate or serialise |
| `db/models/evidence.py`, `schemas/evidence.py`, `shared/lib/types/evidence.ts` | S0.3 | New nullable attribution crosses backend and both frontends |
| `api/v1/endpoints/artifacts.py`, `orchestration/artifact_service.py` | S0.3–S0.4 | Validated attributed upload and INFO event |
| `core/phase_meta.py` | S0.3 / Stage 1 | Evidence-producer catalogue beside, not inside, the screen recipe |
| `dispatcher/lib/realtime/useLiveResource.ts`, `hooks/useTripArtifacts.ts` | S0.4 | Kind-filtered refetch of the artifact endpoint |
| `shared/lib/types/phase.ts` | S0.3 / Stage 4 | Both frontends, only if a rail row type is shared |
| `db/models/enums.py`, `__init__.py`, `migrations/` | Stage 1 | Migration coordination |
| `migrations/versions/` | S0.3 | Hand-write the artifact-column migration and coordinate heads |
| `orchestration/phase_service.py` | S0.3 / Stage 2 / Stage 3 | Completion attribution now; FP-167 before ledger derivation if possible |

`main.py` is **not** touched by any of this — the read endpoint extends the existing phases
router.

## 9 · Environment note

Work continues from VS Code rather than Antigravity. Nothing in the repo depends on the
editor: `.claude/settings.json`, `.claude/hooks/`, `.claude/agents/` and `.claude/skills/`
are committed and travel with the checkout. `CLAUDE.md` loads automatically.

Branch is `Ciaran`, PR into `dev`. `main` and `dev` are both branch-protected. **Claude does
not commit or push — it stages and hands back.**
