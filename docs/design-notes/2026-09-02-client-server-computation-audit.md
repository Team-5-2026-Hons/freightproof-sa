# Client vs Server Computation — Audit

> **Status:** audit, no code changed · **Author:** Ciaran · **Date:** 2026-09-02
> **Scope:** `frontend/dispatcher/`, `frontend/driver-pwa/`, `frontend/shared/`, `backend/app/`
> **Verified against `Ciaran` on 2026-09-02** — every claim below cites `file:line`.
> **Baseline:** `cd backend && pytest` → **890 passed, 4 skipped** (2026-09-02). Tree is sane; no application code was modified by this audit.

**The rule, in one sentence:** *the client may compute anything it likes for display or
for warning the driver early, but no value the client computes may be the reason the
server stores or decides something — the server re-derives every verdict from the ledger
it already owns.*

The headline result: **the codebase already substantially obeys this rule.** The seal
verdict, the scan gate, the anchor, the journey lock hash, exception severity, the phase
plan and the forensic redaction are all server-computed and server-enforced. There is
**one** live category C, it is bounded, and it was a deliberate, documented trade for
offline correctness. The real exposure is category D — four duplicated rules where only
one has a test proving the two sides agree.

---

## 1. The taxonomy

| | Category | Verdict |
|---|---|---|
| **A** | Display-only derivation — client shapes data it already received | Safe |
| **B** | Mirrored pre-validation — client pre-checks for UX, server independently re-validates and decides | Safe, **the pattern to standardise on** |
| **C** | Authoritative client computation — a value the server stores or acts on without recomputing | **Not safe** |
| **D** | Duplicated rule with no equivalence test — both sides implement it, nothing proves they agree | Drift risk |

---

## 2. Every instance found

| # | Location | What it computes | Cat | Server check on the write path? |
|---|---|---|---|---|
| 1 | `driver-pwa/lib/utils/seal-format.ts:5,15` | Seal matches `^[A-Z]{2}-\d{4}$` | **B** | Yes — `schemas/phases.py:20,28-37`, re-run by `@field_validator` at `:256-259` (departure) and `:305-308` (unloading). 422 on failure. |
| 2 | `driver-pwa/lib/utils/activation-gate.ts:73-125` | Why a trip can't be activated (3 rules) | **B** | Yes — `phase_service.py:630-649` `_reject_if_not_due`, plus the two gates after it at `:683,:720`; called from `advance_activation` at `:760`. Raises `TripActivationBlockedError`. |
| 3 | `driver-pwa/lib/phase/derive.ts:42-72` | `currentPhase` / `actionablePhase` — where the driver is, what page opens | **A/B** | Yes — routing only. The server's own sequence gate is `_gate_and_load` (`phase_service.py:208`, sequence check at `:275`); a hand-crafted POST to a later phase gets `PhaseSequenceError`. |
| 4 | `driver-pwa/lib/phase/derive.ts:100-103` `contextPhaseEventId` | Which phase an offline exception is stamped to | **C** | **Partially** — `exception_service.py:42-56` verifies the claimed id belongs to *this trip*, then trusts it. Falls back to server derivation if absent or foreign. See §3.1. |
| 5 | `schemas/phases.py:246` `guard_verified_seal` | A boolean seal verdict the server acts on | **C (dormant)** | **No** — `phase_service.py:1022` writes a CRITICAL `SEAL_MISMATCH` straight off the client's `False`. Not sent by the current app (`driver-pwa/lib/api/phases.ts:50-51`). See §3.2. |
| 6 | `schemas/phases.py:254` `seal_number_confirmed` | The guard's re-entered seal string | **B** | Yes — the server does the comparison itself, `phase_service.py:1015-1021`. The *string* is client input; the *verdict* is not. |
| 7 | `dispatcher/lib/phase/derive.ts:183-189` `anchorTally` | owed / anchored / failed counts | **A** | N/A — read-only dashboard, counted from `anchor_status` the server wrote. |
| 8 | `dispatcher/lib/phase/derive.ts:101-104` `completionPct` | Plan completion % | **A** | N/A — denominator is `phases.length`, server-supplied. |
| 9 | `dispatcher/lib/phase/derive.ts:238-245` `recordedExceptionLabel` | "N exceptions" chip | **A** | N/A — counts records the server created. |
| 10 | `dispatcher/lib/phase/derive.ts:115-148` `currentSealNumber`, `departureSealForLeg` | Which seal is on the truck / on this leg | **A** | N/A — display. Mirrors `_find_departure_for_leg` (`phase_service.py:940-966`) but never feeds a write. |
| 11 | `dispatcher/components/blockchain/ForensicOnly.tsx:14-17` | Whether to render forensic fields | **B** | Yes, and better — the server **redacts at source**: `api/v1/endpoints/blockchain.py:61-66` nulls `receipt`/`expected_hash`/`current_hash` for non-admins. Org scoping at `:50-53`. |
| 12 | `dispatcher/components/auth/AdminOnly.tsx:16` | Whether to render admin UI | **B** | Yes — `require_admin_dispatcher` (`auth/dependencies.py:252-259`) on `drivers.py:60,85`, `precincts.py:63,90`, `vehicles.py:42,65`, `blockchain.py:28`. Role read from JWT `app_metadata`, never from the client (`auth/dependencies.py:166`). |
| 13 | `driver-pwa/lib/utils/sa-id.ts:29` `looksLikeSaIdNumber` | Whether an ID *looks* valid | **A** | N/A by design — hint only, never a gate (`sa-id.ts:1-15`). The gate is `hasRecipientIdentity` at `:40`, which only asks "non-empty". |
| 14 | `driver-pwa/lib/utils/is-queueable-failure.ts:14-17` | Whether to retry a failed submit | **A** | N/A — a client retry policy, no server-side meaning. |
| 15 | `driver-pwa/lib/hooks/useOfflineQueue.ts:303-309` | `idempotency_key` (a client UUID) | **B-ish** | Stored unconditionally (`phase_service.py:482`); replay is short-circuited on the phase's own **status**, not the key (`_gate_and_load`, `:218-230`). Minor robustness note in §3.3. |
| 16 | `driver-pwa/lib/hooks/useVisualCountCarry.ts:22-64` | Carries the unloading count forward in `localStorage` | **A** | N/A — a UI carry-forward between two drafts. The count it feeds is anchored as evidence, not reconciled (`schemas/phases.py:337-343`). |
| 17 | `dispatcher/lib/forensic/describeChange.ts:1-12` | Renders `changed_fields` into rows | **A** | N/A — the critical-field *decision* is server-owned (`blockchain/critical_fields.py`, tested by `tests/unit/test_critical_fields.py`). |
| 18 | `orchestration/phase_plan.py:1-10` ↔ `shared/lib/mocks/phase-trips.ts:83-114` | The phase plan itself | **D** | Server generates it (`trip_service.py:179`); the client never sends one. But nothing tests the two generators agree — §4.1. |
| 19 | `core/phase_meta.py:52-75` ↔ `shared/lib/constants/phase-meta.ts` | `STEP_SLUGS` | **D → resolved** | **An equivalence test exists** — `tests/unit/test_phase_meta_contract.py:33-41` parses the TS file and fails on drift. §4.2. |
| 20 | `exception_service.py:21-22` ↔ `driver-pwa/lib/context/TripContext.tsx:382` | Which exception types are CRITICAL | **D** | Server decides severity (`exception_service.py:98`); the client copy is demo-mode only. Untested duplication — §4.3. |
| 21 | `shared/lib/validation/constants.ts:15-56` ↔ `schemas/vehicles.py`, `schemas/people.py`, `schemas/organisations.py:67-78` | Field widths, patterns, geofence radius bounds | **D** | Yes, all of them — the client copy is pure pre-validation. Untested duplication — §4.4. |
| 22 | `shared/lib/validation/rules.ts:17-127` | Generic rule primitives (`required`, `maxLength`, `pattern`, …) | **B** | Yes — every rule has a Pydantic counterpart. Primitives themselves carry no domain rule. |

### Server-owned, client computes nothing — worth recording as wins

| Value | Where it is computed | Client's role |
|---|---|---|
| `journey_lock_hash` | `trip_service.py:399,423` via `crypto/hashing.compute_journey_lock_hash` | None. Absent from `TripCreateRequest` (`schemas/trips.py:382-399`). |
| The phase plan | `trip_service.py:179` via `phase_plan.build_phase_plan` | None. |
| `blocked_on` | `phase_gate.py:57-111`, derived per request, **never stored** (`schemas/phases.py:77-79`) | Renders it. |
| Unloading seal verdict | `phase_service.py:1121-1150` — server fetches the leg's departure seal from the ledger and compares | Reads `phase.status` (`UnloadingDetail.tsx:45-51`). |
| Exception severity | `exception_service.py:98` | None — `DriverExceptionCreateBody` has no `severity` field. |
| `completed_at` | `phase_service.py:483,550` — server clock (`datetime.now(UTC)`) | None. Cannot be forged. |
| Reconciliation scan-in count | `schemas/phases.py:313-318` — `pp_scan_in_count` **removed from the wire**, now derived from `Parcel.pp_scan_in_at` | None, as of that change. |

That last row is the most instructive thing in the audit and is treated separately in §5.

---

## 3. Category C findings

### 3.1 `phase_event_id` on a driver-raised exception — client-supplied, server-stored

**Where:** `driver-pwa/lib/phase/derive.ts:100-103` computes it; `schemas/transit.py:136-140`
accepts it; `exception_service.py:25-58` resolves it; `:90` stores it.

**What a modified client could cause.** A driver's app that lies about
`phase_event_id` can mis-attribute a panic alert, a seal-broken-in-transit report or any
other driver-raised exception **to a different phase of its own trip**. Concretely: a
driver who breaks a seal during the drive can stamp that exception onto the `activation`
row instead of `in_transit`, so the dispatcher's timeline places the event at the depot
before departure rather than on the road — moving the apparent location of a cargo-theft
event by the length of the trip.

**What it cannot cause.** `exception_service.py:43-48` re-queries the claimed id with
`PhaseEvent.trip_id == trip_id`, so a foreign trip's phase is rejected, logged
(`:52-56`) and replaced with server-derived placement. It cannot cross a trip boundary,
cannot cross an org boundary, and cannot suppress the exception — the record is written
either way. Severity is *not* client-supplied (`:98`), so the alert still fires.

**Why it is like this, and why that reasoning holds.** `exception_service.py:28-40` states
it plainly: the app queues exceptions offline and flushes them hours later, so deriving
placement at request time would tag a panic raised mid-transit with whatever phase the
trip had reached by the time signal returned. *The client knows where the driver was;
the server only knows where the trip is now.* That is correct, and the fallback discipline
(drop the claim, don't 422 — because the offline queue treats 4xx as terminal and would
discard the alert, `:37-40`) is exactly right.

**Recommendation: leave it, but close the gap in the model, not the endpoint.** The reason
the server can't derive placement is that the submission carries **no capture timestamp** —
the only clock on the record is the server's own `completed_at`. If the exception carried
a client `occurred_at` alongside the claimed `phase_event_id`, the server could verify the
claim against the ledger's own timestamps rather than merely bounds-checking it. That is a
schema change, not an audit fix, and it belongs with the step-event ledger work
([2026-09-01-phase-step-event-ledger.md](2026-09-01-phase-step-event-ledger.md)), which
introduces exactly the per-act timestamps this would need. **Do not scope it separately.**

### 3.2 `guard_verified_seal` — a client-computed verdict the server acts on

**Where:** `schemas/phases.py:246`; acted on at `phase_service.py:1022`.

**What it could cause.** An explicit `false` on the wire makes the server write a
**CRITICAL** `SEAL_MISMATCH` exception against the trip (`phase_service.py:1023-1031`) with
no independent evidence behind it. A modified client can therefore manufacture a
critical seal-integrity anomaly on its own trip at will — noise injected into precisely
the signal this platform exists to surface. It cannot manufacture one on another trip
(`_gate_and_load` verifies driver ownership, `phase_service.py:214`).

The converse — suppression — is the more interesting hole, and it is not a code defect:
because guards have no accounts (`CLAUDE.md`, and `schemas/phases.py:238-246`), a driver
whose guard *did* refuse to verify simply omits both fields and no anomaly is recorded.
There is no independent channel to compare against. That is a **domain** limitation of a
zero-login guard, not something a server-side recomputation can fix.

**Current exposure is nil-but-latent.** The shipping app sends neither field
(`driver-pwa/lib/api/phases.ts:50-51`, asserted by `lib/api/__tests__/phases.test.ts:163-166`).
The field survives only so an offline-queued departure from an older build still drains
instead of 422-ing forever — the same back-compat reasoning as
`LoadingCompleteRequest.driver_visual_count` (`schemas/phases.py:203-206`).

**Recommendation.** Keep the field on the schema for the offline-replay reason, but **stop
acting on it**: treat an explicit `false` as it already treats `None`, and let
`seal_number_confirmed` — where the server does the comparison itself (`:1015-1021`) — be
the only path that can raise a seal mismatch at departure. That deletes a category C for
the cost of one `elif` branch. Flagging only; **not doing it here.**

### 3.3 `idempotency_key` uniqueness is global, not per-trip

**Where:** `db/models/phases.py:48-51` — a partial unique index across the whole
`phase_events` table; the value is a client-generated UUID
(`useOfflineQueue.ts:303-309`).

Two different trips whose clients submit the same key collide at flush, which surfaces as
a 500 from Postgres rather than a clean 409. Not exploitable — the colliding value is a
`crypto.randomUUID()` an attacker would have to already know — and `phase_service.py:130-141`
documents that the row lock, not this index, is what actually prevents double-anchoring.
**Robustness note only, no action recommended.**

---

## 4. Category D findings — and the cheapest fix for each

Each of these is one test, not a refactor. None require touching application code.

### 4.1 The phase plan generator (highest value)

`phase_plan.py:6-9` states the contract — *"The two must emit identical plans; the backend
is authoritative if they ever drift"* — and nothing enforces it.
`tests/unit/test_phase_plan.py:3-4` claims to assert "against the frozen reference
implementation ... in `phase-trips.ts:82-114`", but it asserts against **hardcoded tuples
transcribed from that file** (`:23-31`). The backend is pinned to a snapshot of the TS
behaviour; the TS is pinned to nothing. Edit `makePhasePlan` and the suite stays green.

**Cheapest fix:** the pattern already exists in this repo. `test_phase_meta_contract.py`
parses the TS source with a regex and compares (`:22-30`). Do the same shape for
`makePhasePlan` — or, cheaper and more honest, add a **vitest** case in
`frontend/shared/` asserting `makePhasePlan` against the same 7-row and 11-row fixtures
`test_phase_plan.py:23-31` already uses. One file, no production change, and it makes the
existing Python test's docstring true.

### 4.2 `STEP_SLUGS` — already solved; cite it as the template

Contrary to the initial brief, this is **not** an open category D.
`tests/unit/test_phase_meta_contract.py` reads
`frontend/shared/lib/constants/phase-meta.ts`, parses the `STEP_SLUGS` block and asserts
equality (`:33-41`), with the reason stated at `:1-4`: *"This test is the only thing making
that duplication safe — it parses the TS file rather than trusting a comment."* A second
test (`:44-47`) catches a new `PhaseType` with no recipe. **This is the standard the other
three should be brought up to.**

### 4.3 `_CRITICAL_TYPES`

`exception_service.py:21-22` says *"Mirrors TripContext.tsx's criticalTypes set on the
frontend — keep these two in sync"*; the client copy is `TripContext.tsx:382`. Real
severity is server-decided (`:98`), and the client copy is inside an `IS_DEMO_MODE` branch
(`TripContext.tsx:381`), so drift degrades demo fidelity, not production evidence.

**Cheapest fix:** lowest priority of the four. Either a one-line comment correction naming
it demo-only, or fold the constant into `@shared/lib/constants/` so there is one array.

### 4.4 Validation constants

`shared/lib/validation/constants.ts:1-13` is explicit that it duplicates the Pydantic
constraints and that the backend is authoritative. Spot-checked and currently **in
agreement**: geofence radius `50 / 5000 / 200` (`constants.ts:52-54`) matches
`schemas/organisations.py:67-69`; `SA_ID_LENGTH = 13` matches `sa-id.ts:18`.

Drift here is a UX failure, not a security one — a looser client constraint yields a
surprise 422, a tighter one blocks a legal value. The file correctly avoids the one
genuinely dangerous case: it stores no `YEAR_MAX`, because the backend computes
`current year + 1` live (`constants.ts:10-13`).

**Cheapest fix:** one parametrised Python test in the shape of
`test_phase_meta_contract.py`, parsing the `export const` numeric literals and comparing
against the Pydantic `Field(ge=…, le=…)` bounds. Worth doing only for the numeric bounds;
the regexes are not worth cross-parsing.

---

## 5. The benchmarks — what "right" looks like in this codebase

Four patterns already in the tree, in ascending order of how hard they are to get right.

**1. Read the verdict, refuse to re-derive it.**
`UnloadingDetail.tsx:44-51`: *"Read, never re-derived ... Recomputing it here from the two
seal strings would let the dispatcher show 'integrity confirmed' next to an exception the
backend actually raised, which on an evidence platform is the one thing this panel must
never do."* The seals stay on screen so a human can check by eye — display the inputs,
trust the server's verdict.

**2. One module, two consumers — the read schema and the write guard.**
`phase_gate.py:1-7` states it: *"Two consumers — the read schema (so the driver app can
render a waiting screen) and phase_service's completion guard (so a hand-crafted POST
cannot slip past the UI). Both must agree, which is why the logic lives here once rather
than twice."* Verified: `_gate_and_load` calls `blocked_on_by_stop` on the write path and
raises `PhaseBlockedError` (`phase_service.py:282-284`). This is what makes category B
structurally safe rather than safe-by-vigilance.

**3. Redact at the source, not in the component.**
`blockchain.py:61-66` nulls the forensic fields server-side for non-admins. `ForensicOnly`
is then genuinely cosmetic — a non-admin reading the network tab sees nothing extra. The
common anti-pattern (send everything, hide it in the component) was avoided here.

**4. Delete the client's authority when you find it.**
`schemas/phases.py:313-318` records the removal of `pp_scan_in_count` from the wire: *"The
driver app used to send its own `driver_visual_count` in this field, which made the
reconciliation compare a number against itself. The server now derives it from
`Parcel.pp_scan_in_at`."* A category C that made a reconciliation structurally incapable of
detecting anything — found and removed, with the anchored payload key kept unchanged so
historical hash verification still rebuilds. **This is the model for §3.2.**

---

## 6. Recommended standard

For the team to adopt. Five rules, each already demonstrated somewhere in the tree.

1. **The server never trusts a client verdict.** A boolean, count, status, severity,
   eligibility or permission the client computed is a *hint*. If the server stores or acts
   on it, it must re-derive it from data it already holds. Where it genuinely cannot
   (§3.1), say so in the schema comment and bound the damage — verify what *can* be
   verified, and fall back rather than reject.

2. **Mirrored pre-validation is encouraged, and must name its counterpart.** Every
   client-side rule that exists for UX gets a header comment citing the backend file and
   symbol it mirrors, and stating that the backend wins. `seal-format.ts:1-4`,
   `activation-gate.ts:1-9` and `validation/constants.ts:1-13` already do this. Keep it.

3. **A duplicated rule needs a test, not a comment.** "Keep these in sync" is not a
   control. `test_phase_meta_contract.py` is the template: parse the other side's source
   and assert equality. Cost is one file; it is the only thing that turns a category D
   into a safe duplication.

4. **Gate once, in one module, with both consumers wired to it.** When a rule governs both
   what the UI shows and what a write accepts, it lives in one place server-side and both
   paths call it — `phase_gate.py`. Never a read-schema copy and a guard copy.

5. **Redact server-side.** If a field is not for this role, do not send it and hide it —
   null it in the response model (`blockchain.py:61-66`). Client-side hiding is a
   presentation choice, never an access control.

**Review question for any PR that adds a field to a `*Request` schema:** *does the server
recompute this, or does it believe it?* If it believes it, that belief needs a paragraph
in the schema comment explaining why, what the blast radius is, and what bounds it.

---

## 7. Unverified / out of scope

Reported rather than dropped, per the audit's own rule.

- **`frontend/shared/lib/validation/driver.ts`, `vehicle.ts`, `precinct.ts`** — read for
  their constant imports only, not line-by-line against every Pydantic counterpart. They
  compose `rules.ts` primitives over `constants.ts` values, so they inherit row 21's
  category D. No separate finding, but the field-by-field equivalence is **unverified**.
- **`useSLAMetrics`, `usePpCapabilities`, `useBlockchainReceipts`** — read-only dispatcher
  hooks over server endpoints. Assumed category A from their call shape; **not read in
  full**.
- **`driver-pwa/lib/phase/routes.ts`, `registry.ts`** — step routing. Category A by
  construction (they map slugs to components), **not audited line-by-line**.
- **Guard page and receiver OTP flows** — documented as having no accounts
  (`CLAUDE.md`); no client computation surface was found, but these were not
  independently traced.
- **The graph** (`graphify-out/`) was built 2026-08-26 and predates the precinct commits
  of 1–2 September. It was used to locate files, not to make claims; every claim above was
  read from source on 2026-09-02.
