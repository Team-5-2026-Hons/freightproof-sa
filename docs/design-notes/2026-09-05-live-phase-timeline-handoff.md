# Live sub-phase timeline — session handoff

> **Author:** Ciaran · **Date:** 2026-09-05 · **Status:** handoff, work not started
> **Purpose:** this is the entry point for a fresh session. It exists because the reasoning
> that protects this codebase lives in conversation, not in code, and a session that starts
> cold will delete things it should not. Read §5 before touching anything.
> Every claim carries the command that re-checks it. Line numbers move — match on content.

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

## 2 · Where the code stands

Seven commits ahead of `origin/dev` on branch `Ciaran`, tree clean, all suites green:

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

## 3 · The call to make first: cheap path or full path

There are two ways to build this and they differ by an order of magnitude. **Decide before
writing code.**

### Path A — capture-time rail (no table, no migration, no `phase_service.py` edit)

Surface `evidence_artifacts.captured_at` as act rows under each phase card. This is S0.3 in
the ledger plan.

**Corrected finding, 2026-09-05.** The plan says `captured_at` is *"written today and
rendered nowhere."* That is wrong — it is already rendered:

```bash
grep -rn "captured_at" frontend/dispatcher frontend/shared/lib/types/evidence.ts \
  backend/app/schemas/evidence.py --exclude-dir=node_modules --exclude-dir=.next
```

| Where | State |
|---|---|
| `db/models/evidence.py:46` | `nullable=False` — always populated |
| `api/v1/endpoints/artifacts.py:37` | collected on upload as a form field |
| `orchestration/artifact_service.py:94` | **already ordered by it** |
| `schemas/evidence.py:21` → `types/evidence.ts:17` | already on the wire |
| `EvidencePhoto.tsx:28`, `EvidenceDocument.tsx:29` | rendered — but *inside* each artifact, behind a chevron |

So Path A is **re-presentation of data already flowing**, not new plumbing. No backend
change at all. That makes it materially cheaper than the plan implies.

### Path B — the step-event ledger (Stages 1 → 2 → 4)

A real `phase_steps` table with `actor_type`, `sequence_number`, `occurred_at` /
`recorded_at`, `event_hash`, `idempotency_key`. Stage 4 is **blocked on Stages 1–2, not on
Stage 3** — the Merkle/anchoring work is not on this path.

### The boundary that decides it

**Path A can only timestamp steps that captured evidence.** A step that produces no artifact
— "trip adopted", "activation attested" — has no timestamp source without the ledger. If the
requirement is *every* step timestamped, Path A cannot deliver it and Path B is the answer.

**Recommendation: Path A first, then re-decide.** It is hours rather than days, it delivers
most of the visible win, and it answers the question that decides whether Path B's rail is
even viable — the ledger plan's own Stage 4 criterion is *"an 11-phase cross-dock plan
rendered at ~55 acts in a 420 px column, legible."* Build it on `app/dev/design/page.tsx`
first with that density case, per §9.3. Find out whether the always-visible rule survives
**before** building a table to feed it.

## 4 · Suggested order

```
A → B          emit invariant, then kind-filtered subscription
               (see 2026-09-04-exception-queue-scaling.md; §9.4's precondition
                for any live rail — A GATES B, do not reorder)
S0.3           capture-time rail on dev/design first, then the real page   ← Path A
S0.4           artifact-upload realtime kind, so the rail fills live
─────────────  re-decide here, with the density question answered
FP-167         phase_service.py split (Stage 2's preparation)
D-8            how a derived row reads — decide BEFORE writing Stage 2
Stage 1 → 2 → 4                                                            ← Path B
```

## 5 · Traps — read this before deleting anything

### 5.1 · Code that looks dead and is deliberately kept

**Do not delete or make required.** Each survives for a stated reason:

| Thing | Why it stays |
|---|---|
| `guard_verified_seal`, `seal_number_confirmed` (`schemas/phases.py`, `phase_service.py`) | No client sends them; the driver app dropped them 2026-08-05. **The offline queue treats a 4xx as terminal and DISCARDS the entry**, so making them required or deleting them permanently strands queued departures carrying valid evidence. The `Optional[bool]` tri-state is load-bearing: `None` = "not collected" and is the normal case; a falsy check stamps a CRITICAL `seal_mismatch` on every trip. Four tests hold the line at `test_phase_service.py:705-790`. Reasoning is at `driver-pwa/lib/api/phases.ts:50`. |
| `waybill_photo_artifact_id` | Same offline-replay reasoning. |
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

## 8 · Shared files — coordinate before changing

Per `CLAUDE.md`: `backend/app/main.py`, `core/config.py`, `db/models/__init__.py`,
`requirements.txt`, both `package.json`, `docker-compose.dev.yml`, `CLAUDE.md`.

For this work specifically:

| File | Path | Note |
|---|---|---|
| `core/realtime.py` | S0.4 | Three tickets, one file. Coordinate or serialise |
| `shared/lib/types/phase.ts` | S0.3 / Stage 4 | Both frontends |
| `db/models/enums.py`, `__init__.py`, `migrations/` | Stage 1 | Migration coordination |
| `orchestration/phase_service.py` | Stage 2 | Hot on three branches — FP-167 first if possible |

`main.py` is **not** touched by any of this — the read endpoint extends the existing phases
router.

## 9 · Environment note

Work continues from VS Code rather than Antigravity. Nothing in the repo depends on the
editor: `.claude/settings.json`, `.claude/hooks/`, `.claude/agents/` and `.claude/skills/`
are committed and travel with the checkout. `CLAUDE.md` loads automatically.

Branch is `Ciaran`, PR into `dev`. `main` and `dev` are both branch-protected. **Claude does
not commit or push — it stages and hands back.**
