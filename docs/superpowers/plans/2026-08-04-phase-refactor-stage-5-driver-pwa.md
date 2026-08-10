# Stage 5 — Driver-app plan-driven engine

**Created:** 2026-08-04 · **Owner:** Tim · **Branch:** `Phase-refactor`
**Parent:** `docs/superpowers/plans/2026-07-25-phase-model-refactor.md` §7 Stage 5
**Status:** ready to execute

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

**Stage-5-specific invariant (F1).** The driver must never be shown an expected or reference
cargo count before entering their own. A visible expected number makes a "match" prove nothing.
The driver enters a blind count; the server reconciles privately and returns only a verdict.

---

## Objective

The driver walks whatever phase plan its trip actually has — 7 rows for a single leg, 11 for a
three-stop cross-dock — instead of a fixed 1–5 handshake route.

## Why now

Stage 4 cut the shared contract over to the phase model in one commit (`b26ebbb`) and deliberately
left `driver-pwa` broken; mapping it onto the phase types is this stage. That debt is now blocking:
commit `c132f45` added the driver-pwa CI job (`.github/workflows/ci.yml:96-118`) in the same push
that deleted the types it depends on, so **CI on this branch is red today** and stays red until
Stage 5 lands.

## Verified baseline (measured 2026-08-04, not estimated)

| Gate | Real result |
|---|---|
| `npx tsc --noEmit` | **56 errors across 17 files** |
| `npx vitest run` | **17 of 57 files fail at collection**; 260/260 tests that do run pass |
| `npx eslint .` | **clean, exit 0** |
| CI driver-pwa job | **exists and is red** |

The parent plan's "95 files (61 source + 34 test)" was a `grep -ril handshake` count, not a
compiler count. The real blast radius is smaller, and the compiler is a hard gate on all of it.

⚠️ **vitest's 260 green overstates health.** Files importing dead modules with `import type`
have those imports stripped by esbuild before Vite resolves them, so `handshake-progress.test.ts`,
`trip-filters.test.ts` and several source files run green while failing `tsc`. **`tsc --noEmit` is
the honest signal in this stage, not vitest.**

## Prerequisites

- [x] `frontend/driver-pwa/node_modules` installed — without it `npm run type-check` reports
      `command not found` and some CI wrappers read that as exit 0 (the false-green trap in
      `docs/superpowers/stage-5-breakage-inventory.md`).
- [x] Frozen contract present: `shared/lib/types/phase.ts`, `shared/lib/constants/phase-meta.ts`.
- [x] Backend phase API live: `GET /api/v1/trips/{id}/phases`, `/phases/next`,
      `POST /api/v1/trips/{id}/phases/{phase_event_id}/complete`.

---

## Decisions taken at Stage 5

These close parent-plan open items 2 and 4 (§10) and one contract conflict found while planning.

### D10 — The URL keys on `phase_type`, never on `phase_event_id`

The parent plan suggested "key by phase-event id, or `stop/{k}/{type}`". **Both are impossible
here.** `driver-pwa` builds with `output: 'export'` for the Capacitor APK, which requires every
dynamic segment to be enumerable at build time by `generateStaticParams`. A `phase_event_id` is a
server-generated UUID that does not exist until a trip is created; `stop/{k}` is unbounded in `k`.

The app already solved this exact problem for the trip id — `lib/constants/routes.ts:1-9` keeps a
trip's UUID out of the URL entirely and resolves it from `TripContext`. Stage 5 follows that
precedent:

```
/trip/phase/[type]/step/[slug]        type ∈ PhaseType, slug ∈ STEP_SLUGS[type]
```

16 statically-enumerable pages. The **`phase_event_id` is resolved client-side** as "the current
unresolved phase of my active trip", exactly as `tripId` is today.

**Why this is not a workaround.** A cross-dock plan contains `unloading` three times. Keying the
URL by phase-event id would give three different URLs for the same screen; keying by type gives
one screen whose identity resolves to whichever `unloading` is currently next. The URL describes
*what the driver is doing*; the ledger says *which row it lands on*. That is the phase model's
own separation, applied to routing.

**Fence:** a step page must never trust `[type]` as the source of truth. It resolves the current
phase from the plan and, if that phase's type differs from the URL, redirects. Deep links and
stale back-navigation cannot submit against the wrong row.

### D11 — `loading` gets one blind count step; the empty recipe was wrong

`phase-meta.ts:32` declares `loading: []`, and parent §2.5 describes P2 as system-observed with no
driver input. **The shipped backend disagrees, and it is load-bearing:**

- `advance_loading` (`phase_service.py:283-301`) requires `driver_visual_count: int`.
- `PhaseType.LOADING` is in the dispatch table (`phase_service.py:611`).
- `advance_confirmation` reads `origin_count = loading_event.driver_visual_count`
  (`phase_service.py:555`) for the three-way reconciliation verdict at P6.
- **Nothing else calls `advance_loading`** — no Celery task, no PP poll. Grep confirms it.

So with an empty recipe, no trip can ever pass `loading`, and P6's reconciliation has no origin
count to compare against.

**Resolution: `loading: ['1-visual-count']`, with no reference value displayed.** This does not
violate F1 — F1 forbids *showing* the driver an expected count, not the driver entering their own.
A blind count is precisely what makes the server's private three-way reconciliation meaningful.

⚠️ **This edits `shared/lib/constants/phase-meta.ts`, a D9 shared file. Ciaran must be notified.**
The change is additive and matches his own backend; the constant was over-applied relative to it.

**Fence:** the loading count step renders **no** expected value, no PP figure, and no mismatch
banner. `H5VisualCount.tsx`'s existing mismatch-banner behaviour must NOT be carried into it.

### D12 — The 18 `H{n}*.tsx` components are renamed to phase names now

Parent §10 item 4, decided. The numbers do not merely look dated — they become false:
`H2Waybill` serves `departure`, `H4SealVerify` serves `unloading`. Renaming now costs one
mechanical commit; leaving it means every reader must hold a translation table.

### D13 — `in_transit`'s step recipe is vestigial under the Stage-2 stopgap; do not "fix" it

`STEP_SLUGS.in_transit = ['1-arrival']`, but `in_transit` is excluded from `PhaseCompleteRequest`
(`schemas/phases.py:191-193`) and auto-completed server-side by `_auto_complete_in_transit`
(`phase_service.py:308-335`) the moment `departure` advances — an explicit Stage-2 stopgap pending
checkpoint Merkle batches (D2). Addressing it returns 409.

Therefore, after `departure` completes, the next *unresolved* phase is already `unloading`, and the
`1-arrival` step is never reached by the walk. The existing `/trip/in-transit` hub screen covers
the driving period.

**Fence:** the `in_transit` step page must never submit. The walk skips it because it is already
resolved — not because of a special case. **Do not add a hard-coded "skip in_transit" branch**;
that would be a fixed-length assumption in disguise. The generic rule "advance to the lowest-
sequence unresolved phase" handles it for free, and keeps working when real checkpoint batches
replace the stopgap.

---

## Tasks

Each task ends with `npx tsc --noEmit` strictly better than it started, and `npx vitest run` with
no new collection failures.

### 5.0 — Shared contract corrections *(D9 shared files — flag every one)*

**Where:** `frontend/shared/lib/constants/phase-meta.ts`, `frontend/shared/lib/types/phase.ts`,
`frontend/shared/lib/types/exception.ts`, `frontend/shared/lib/mocks/trips.ts`,
`frontend/shared/lib/constants/copy.ts`

1. `STEP_SLUGS.loading = ['1-visual-count']`, `STEP_NAMES.loading = ['Visual Count']` (D11).
2. Add `idempotency_key: string | null` to `PhaseDescriptor` — the backend serialises it
   (`schemas/phases.py:66`) so a client can reconcile its queue, and the shared type omits it.
3. Rename `handshake_event_id` → `phase_event_id` in `types/exception.ts:43` to match
   `schemas/transit.py:77`; update the 9 keys in `mocks/trips.ts`.
4. Remove the dead `'Start trip · Begin Handshake 1'` string in `copy.ts:36`.

**Fence:** no other change to shared. Do not touch `PHASE_NAMES` or `ANCHORED_PHASES`.

### 5.1 — Pure phase-derivation module

**Where:** create `frontend/driver-pwa/lib/phase/` — `derive.ts`, `routes.ts`, `index.ts`

Pure functions over `readonly PhaseDescriptor[]`, no React, no fetch:

- `currentPhase(phases)` — lowest `sequence_number` whose status is not resolved
  (`completed | exception | overridden`), mirroring the backend's `next_phase`. `null` when closed.
- `stepsFor(phase)` — `PhaseStep[]` built from `STEP_SLUGS[phase.phase_type]`.
- `nextStepRoute(phases, phase, slug)` — next slug in the recipe, else the first step of the next
  unresolved phase, else the terminal route.
- `planProgress(phases)` — `{ completed, total }` where `total = phases.length`.

**Fence:** this module may not import React, `next/navigation`, or any API client. It is the one
place sequencing lives, and it must be unit-testable against a fixture alone. **No literal `5`,
`6`, `7`, or `11` may appear in it.**

### 5.2 — API layer and offline queue rewire

**Where:** create `lib/api/phases.ts` (delete `lib/api/handshakes.ts`); edit `lib/api/trips.ts`,
`lib/hooks/useOfflineQueue.ts`, `lib/hooks/useHandshakeDraft.ts` → `usePhaseDraft.ts`

1. `completePhase(tripId, phaseEventId, request)` → `POST /trips/{tripId}/phases/{phaseEventId}/complete`,
   replacing `completeH1..completeH5` (`trips.ts:50-63`), which now 404 — those routes are gone.
2. One payload builder per phase type producing the discriminated-union variant
   (`activation | loading | departure | unloading | confirmation`), discriminated on `phase_type`.
   Photo uploads still go through `uploadArtifact()` first.
3. **5.3 idempotency:** every variant requires `idempotency_key: string`. Use the offline-queue
   entry's existing `id` (`useOfflineQueue.ts:228`, already a `crypto.randomUUID()` generated once
   per logical submission and stable across retries). Thread it through the submit path — online
   submissions generate one the same way so the online and replay paths are identical.
4. Queue entry changes from `{ handshakeType, evidence }` to
   `{ phaseEventId, phaseType, evidence, idempotencyKey }`.

**Fence:** keep `ApiError.status === 0` as the transient/terminal discriminator in `flushQueue` —
that logic is correct and unrelated to the phase model. Do not touch the checkpoint or exception
queue kinds beyond the `phase_event_id` rename.

**Note:** the server dedupes on the addressed row's status, not on the key
(`phase_service.py:108-134`) — a replay against a resolved phase returns 200 with the current trip.
So offline replay of a completed phase is already a no-op server-side; the client must not treat
that 200 as a fresh completion.

### 5.3 — Step components renamed and re-parented *(D12)*

**Where:** `frontend/driver-pwa/components/handshake/steps/` → `components/phase/steps/<type>/`

Direct re-parents (no logic change): `H1GateArrival`→`activation/GateArrival`,
`H1Verification`→`activation/Verification`, `H3ApproachExit`→`departure/ApproachExit`,
`H2Waybill`→`departure/Waybill`, `H3Departure`→`departure/ConfirmDeparture`,
`H5HandWaybill`→`unloading/HandWaybill`, `H4SealVerify`→`unloading/SealVerify`,
`H5SealInspection`→`unloading/SealBreakInspection`, `H5VisualCount`→`unloading/VisualCount`,
`H5Reconciliation`→`confirmation/Reconciliation`, `H5Closed`→`confirmation/Closed`.

Real changes:
- `H2Seal` → `departure/CaptureSeal` — the seal is now captured at departure (D7).
- `H5PodPhoto` **splits** into `confirmation/PodPhoto` and `confirmation/PodSignature`.
- **New** `loading/VisualCount` — blind count, no reference shown (D11 fence).
- `unloading/VisualCount` must **drop** its `h2Count` mismatch banner (F1).
- `h2SealNumber` prop → `referenceSealNumber`; `sealsMatch()` helper survives unchanged.
- `StepHeader` takes `{ phase: PhaseDescriptor; stepIndex: number }`, not `{ handshake, step }`.

Retire: `H2ArriveBay`, `H2Linehaul`, `H2Review`, `H3ExitSeal`, `H4ApproachDest` — their phases no
longer exist as separate steps. **Preserve `sealsMatch()` from `H3ExitSeal` before deleting it.**

**Fence:** capture components (`CameraCapture`, `GpsCapture`, `SealInput`, `SignaturePad`,
`EvidenceReview`, `HoldButton`) stay generic and are not touched. Only the *sequence* becomes data.

### 5.4 — Route cutover

**Where:** create `app/(app)/trip/phase/[type]/step/[slug]/{page.tsx,PhaseStepPageClient.tsx}`;
delete `app/(app)/trip/handshake/`; edit `lib/constants/routes.ts`, `lib/navigation/`,
`next.config.ts`

1. `generateStaticParams` enumerates `PhaseType × STEP_SLUGS[type]` (D10).
2. `PhaseStepPageClient` resolves the current phase from `TripContext`, redirects if the URL type
   does not match, renders the step component from a `phase_type → slug → component` registry,
   and submits via `completePhase` on the final step of each recipe.
3. Replace `STATUS_ORDER` / `isAtOrPast` duplicate-submit detection
   (`HandshakeStepPageClient.tsx:63-70`): coarse `TripStatus` has no ordinal signal left. Detect
   via the addressed phase's own `status` in the returned plan.
4. **`next.config.ts:99-108` holds a third hand-maintained copy of the step slugs** for the service
   worker's offline precache list, because it runs outside the `@shared/*` alias. It must be
   updated to the new routes or the SW install 404s and hard-fails (`next.config.ts:129-133`).
5. `lib/navigation/handshake-flow.ts` retires; its hard-coded `handshake === 3 → in-transit` /
   `handshake === 5 → trips` branches (`:30-40`) are replaced by 5.1's `nextStepRoute`.

**Fence:** no route may contain a UUID segment — it breaks `output: 'export'` and the APK build.

### 5.5 — Trip views off the plan

**Where:** `components/trip/TripDetailView.tsx`, `CurrentHandshakeCard.tsx`→`CurrentPhaseCard.tsx`,
`HandshakeProgressBar.tsx`→`PhaseProgressBar.tsx`, `components/home/HomeContent.tsx`,
`lib/utils/handshake-progress.ts`→`lib/phase/derive.ts` (folded in), `lib/hooks/useStepIndicator.ts`,
`lib/utils/trip-status-chip.ts`, `lib/utils/trip-filters.ts`,
`app/(app)/trips/active/ActiveTripPageClient.tsx`, `app/(app)/trip/in-transit/InTransitPageClient.tsx`

- `PhaseProgressBar` renders `phases.length` cells, not 5. The current fixed 5-cell flex row
  (`HandshakeProgressBar.tsx:32`) cannot show an 11-row plan — it needs to scroll or compress.
- `TripDetailView.tsx:18` `ANCHORED_HANDSHAKE_NUMBERS = new Set([2, 5])` → `ANCHORED_PHASES`
  from `phase-meta.ts` (a different set, by type: `trip_creation`, `departure`, `confirmation`).
- `trip-status-chip.ts` re-keys onto the coarse five.
- `InTransitPageClient.tsx:125`'s hard-coded `ROUTES.handshakeStep(4, ...)` → the next unresolved
  phase's first step, via 5.1.
- `H5Closed`'s "All five handshakes are done" copy becomes plan-length agnostic.

**Fence:** these are read paths. They may use `current_phase`/`current_stop` for display, but
must derive position from `trip.phases` (D6 — no write path branches on the cache).

### 5.6 — Test sweep

**Where:** `frontend/driver-pwa/**/__tests__/`

Rewrite the 11 DEAD and 7 REWRITE files identified in the survey; the 39 SAFE files stay.
New regression tests in **5.1's pure module** are the priority — see below.

---

## Tests to write

| Test | Behaviour it proves |
|---|---|
| `lib/phase/__tests__/derive.test.ts` — walk `SINGLE_LEG_PHASE_PLAN` (7) **and** `CROSS_DOCK_PHASE_PLAN` (11) | Sequencing is plan-length agnostic. **The single highest-value test in the stage.** |
| same file — a plan where `unloading` appears 3× | `currentPhase` resolves by `sequence_number`, not by first type match — the cross-dock bug that a type-keyed lookup would introduce |
| same file — phase with an empty recipe | The walk advances past a zero-step phase without stalling |
| same file — `in_transit` already `completed` | The walk reaches `unloading` with no special-case branch (D13) |
| `lib/phase/__tests__/routes.test.ts` | `nextStepRoute` advances within a recipe, across phases, and terminates |
| seal capture at `departure`, verify at `unloading` | Replaces `SealReferencePersistence.test.tsx`. The parent plan's 🔴 risk: a NULL==NULL seal comparison raises nothing and fails no test. **Write before touching seal code.** |
| anchor copy keyed to `ANCHORED_PHASES` | Replaces `HandshakeStepPageClient.anchoring.test.tsx`, which enshrines the *wrong* two phases (loading/unloading) |
| loading count step renders no reference value | F1 — the fence on D11 |
| draft survives a mount that begins before `trip` loads | Preserves the shipped fix in `HandshakeStepPageClient.tripgate.test.tsx` |
| offline replay of a completed phase is a no-op | Parent Stage 5 verification line |
| `TripDetailView` against an 11-phase trip | Replaces "lists all five handshakes" |

## Out of scope

- **Anything under `frontend/dispatcher/`** — Ciaran's, Stage 4, already landed.
- **All backend files** — the phase API is live and frozen for this stage. The `advance_loading`
  conflict is resolved on the *frontend* side (D11); no backend edit.
- **`shared/lib/types/phase.ts` beyond adding `idempotency_key`**, and `PHASE_NAMES` /
  `ANCHORED_PHASES` — D9, Ciaran's.
- **`lib/api/checkpoints.ts`, `lib/api/exceptions.ts`, panic flow** — unaffected by the phase cut
  beyond the `phase_event_id` rename.
- **Capacitor `android/` and `ios/` projects** — no native change; routes stay statically exportable.
- **Real checkpoint Merkle batching for `in_transit`** — D2/D13, blocked on backend work.
- **CI workflow edits** — the driver-pwa job already exists and is correct; it just needs to go green.

## Verification

```bash
cd frontend/driver-pwa
npx tsc --noEmit          # expect: 0 errors (from 56)
npx eslint .              # expect: exit 0, still clean
npx vitest run            # expect: 0 collection failures (from 17), all tests pass
npm run build             # expect: static export succeeds — proves output:'export' still works
```

Then, against a live backend with a seeded multi-stop trip:

- A driver walks a seeded **single-leg (7-row)** trip start to finish.
- A driver walks a seeded **cross-dock (11-row)** trip, hitting `unloading` more than once.
- Offline replay of an already-completed phase is a no-op (200, no duplicate ledger row).
- **No cargo count is displayed to the driver at any point** — only entered blind.

## Done when

`npx tsc --noEmit` is clean, the driver-pwa CI job is green for the first time since `c132f45`,
and a driver can walk both a 7-row and an 11-row seeded trip end to end — with the 11-row walk
passing through `unloading` more than once.

---

## Shared files touched — flag in PR

| File | Change | Owner to notify |
|---|---|---|
| `shared/lib/constants/phase-meta.ts` | `loading` recipe (D11) | **Ciaran (D9)** |
| `shared/lib/types/phase.ts` | add `idempotency_key` | **Ciaran (D9)** |
| `shared/lib/types/exception.ts` | `handshake_event_id`→`phase_event_id` | Ciaran |
| `shared/lib/mocks/trips.ts` | 9 key renames | Ciaran |
| `shared/lib/constants/copy.ts` | delete dead string | — |

No `.env` keys. No migrations. No backend change.
