# SOLID & Structure Audit — Refactor Targets for Iteration 4

| | |
|---|---|
| **Written** | 2026-09-02 |
| **Author** | Ciaran (with Claude Code) |
| **Pinned to commit** | `16f0210` on `dev` |
| **Trigger** | Lecturer feedback, iteration 3 demo meeting — see §0 |
| **Status when written** | 580 unit + 331 integration tests green |
| **Read before** | Iteration 4 code demo |

> **This document is a snapshot, not a living spec.** It was measured against one
> commit. Run the staleness check in §1 before trusting any number in it. If the
> fingerprints have moved, the *findings* are probably still directionally right
> but the *line numbers and counts are not* — re-verify before quoting them at a demo.

---

## 0. The feedback this responds to

From the lecturer meeting summary:

- Feedback was around **software engineering principles**, not just tech stack
  - Tech stack: how you build the thing
  - **SOLID principles: how you write the code**
  - **Design patterns: structural approach to how you code**
- Suggestion: **refactor where possible rather than re-engineer from scratch**
- Not strictly OOP-required, but **SOLID principles are part of the marking rubric**

### The honest read

The critique is not about the stack — the stack is current and appropriate. It is this:

> **The entire orchestration layer — 18 modules, ~5,500 lines — contains 7 classes,
> and all 7 are frozen dataclasses used as return records.** There is not one
> behavioural class in the business-logic layer.

That is a legitimate style choice (it is idiomatic FastAPI), but it means when a
marker asks *"show me Liskov substitution"* or *"where is your Strategy pattern"*,
there is nothing to point at — **even though several patterns are already
implemented correctly, just never named**.

The fix is **not** to OOP-ify everything. It is to:
1. Name and complete the patterns already present (§2).
2. Fix the four places where a principle is genuinely violated (§3).
3. Delete what is provably dead so the structure reads clearly (§5).

---

## 1. Staleness check — run this first

These were the measured values at `16f0210`. If they differ materially, this doc
is out of date.

```bash
cd /path/to/freightproof-sa-4

# Fingerprint A — god-module line counts
wc -l backend/app/orchestration/phase_service.py \
      backend/app/orchestration/trip_service.py \
      "frontend/dispatcher/app/(app)/trips/new/page.tsx"
# Expected at 16f0210:  1441 / 754 / 1113

# Fingerprint B — duplicated anchor-payload shape (§3, V2)
grep -rc '"changed_by_user_id": str' backend/app/orchestration/*.py
# Expected: driver_service 2, vehicle_service 2, precinct_service 2,
#           verification_service 3   → 9 copies total

# Fingerprint C — the two parallel enum dispatch chains (§3, V1)
grep -rn "elif .*SubjectType\." backend/app | wc -l
# Expected: 10  (6 in subject_visibility.py, 4 in verification_service.py)

# Fingerprint D — production code importing test fixtures (§4)
grep -rn "lib/mocks" frontend/dispatcher frontend/driver-pwa \
  --include='*.ts' --include='*.tsx' | grep -v '__tests__\|\.test\.' | wc -l
# Expected: 11

# Fingerprint E — test baseline
cd backend && .venv/bin/python -m pytest tests/unit -q | tail -1
# Expected: 580 passed, 4 skipped
```

| Fingerprint | Value at `16f0210` | Meaning if changed |
|---|---|---|
| A | 1441 / 754 / 1113 | §6 split plans need re-reading against the new shape |
| B | 9 copies | someone started (or worsened) the V2 refactor |
| C | 10 branches | someone added a `SubjectType`, or started V1 |
| D | 11 importers | mock-in-production is being cleaned up (or spreading) |
| E | 580 / 4 | the safety net for all of this has moved |

---

## 2. What is already correct — defend these, don't touch them

These are the answers to give when asked to point at SOLID in the viva.

| Principle | Where | Why it counts |
|---|---|---|
| **DIP** | `integrations/scan_feed.py:94` | `ScanFeed(Protocol)` + `MockScanFeed` + `get_scan_feed() -> ScanFeed`. Textbook: the factory's return type is the *abstraction*, not a concretion. **Best pattern example in the repo.** |
| **DIP** | `blockchain/hedera.py:55` | `_HederaAdapter(Protocol)` isolates the pyjnius/Java SDK behind a one-method port. |
| **ISP** | `schemas/phases.py:160–311` | `_PhaseCompleteBase` + 6 per-phase request models. No client depends on fields it does not use. |
| **OCP** | `phase_service.py:1356` | `complete_phase` uses a dispatch **table**, not an if/elif chain — and the decision is written out in the comment above it. |
| **SRP** | `orchestration/integrity.py` | 42 lines, one job: reading a Postgres unique-violation without depending on driver wrapping. Exists so the `exc.orig.__cause__` trap is solved exactly once. |
| **Strategy** | `core/limits.py` + `rate_limit(LIMIT)` | Rate limits as injected config objects, not hardcoded numbers per route. |

**Also worth protecting:** comment density is unusually high and it is *rationale*,
not narration — e.g. `phase_service.py:126` explains why a row lock rather than a
unique index; `blockchain/critical_fields.py` explains why `is_shared` counts as
critical. **Do not strip these while refactoring.** They are a genuine strength and
they are what makes the refactors below defensible at examination.

---

## 3. Genuine violations — ranked by marks-per-hour

### V1 — OCP + DRY: the `SubjectType` shear
*Highest value, lowest risk.*

The **same enum is dispatched by two parallel if/elif chains in two different layers**:

```
backend/app/blockchain/subject_visibility.py:32-84       7 branches
    → which table proves org ownership

backend/app/orchestration/verification_service.py:207-234  5 branches
    → how to rebuild the canonical payload
```

Add one `SubjectType` and you must edit two chains in two layers, or it silently
misbehaves. Worse, `verify_subject`'s five branches are byte-identical apart from
one function name:

```python
elif subject_type == SubjectType.VEHICLE_EVENT:
    rebuilt = await _reconstruct_vehicle_event_payload(db, subject_id)
    if rebuilt is None:
        return VerifyOutcome(status=VerifyStatus.NO_RECEIPT, receipt=receipt)
    current_hash = _hash_payload(rebuilt)
elif subject_type == SubjectType.DRIVER_EVENT:      # ← same 4 lines
elif subject_type == SubjectType.PHASE_EVENT:       # ← same 4 lines
elif subject_type == SubjectType.PRECINCT_EVENT:    # ← same 4 lines
```

**Refactor:** one `SubjectPolicy` Protocol exposing `visibility_query()` and
`reconstruct_payload()`, plus a `dict[SubjectType, SubjectPolicy]` registry.
~35 lines collapse to ~8, and adding a subject type becomes *adding a class*
rather than editing a branch in two files. That is the literal definition of
Open/Closed and can be stated in one sentence at the demo.

**Keep the existing fail-closed behaviour:** the current `else:` raises
`SubjectNotVisibleError`, so an unregistered subject type denies rather than
leaks. The registry must preserve that — a missing key is a denial, not a `KeyError`.

**Covered by:** `tests/unit/test_subject_visibility.py`, `tests/unit/test_verification_service.py`

---

### V2 — DRY + Template Method: the audit-and-anchor algorithm, written 3× and reconstructed 4× more

`driver_service`, `vehicle_service`, and `precinct_service` each run the identical
six-step algorithm:

```
load & org-scope → snapshot old → apply patch → diff_critical_fields()
→ write XEvent row + flush → if diff: anchor_subject() → stamp receipt id
```

Verified locations:

| Service | create | update |
|---|---|---|
| `driver_service.py` | 91–142 | 205–228 |
| `vehicle_service.py` | 112–145 | 232–262 |
| `precinct_service.py` | 164–190 | 278–308 |

And this **6-key payload dict is written out 9 separate times**:

```python
{"<x>_event_id": ..., "<x>_id": ..., "event_type": ...,
 "fields": ..., "changed_by_user_id": ..., "timestamp": ...}
```

- 6 copies in the three services (the anchor side)
- 3 copies in `verification_service.py:104, 122, 196` (the reconstruct side)

**Why this is more than tidiness:** those 9 dicts are *hash inputs*. If one drifts
from its counterpart, verification reports **tampering that never happened**.
`_reconstruct_precinct_event_payload`'s own docstring already warns about exactly
this failure mode — which is the argument for making it structurally impossible.

**Refactor:** an `AuditedResource` base (Template Method) or a
`record_and_anchor(db, *, entity, event_model, critical_fields, receipt_type, ...)`
helper. Roughly −180 lines.

**Watch out:** `vehicle_service.py:236-244` hashes `pulsit_device_id` before
anchoring (POPIA). Any shared helper needs a per-resource "canonicalise before
hashing" hook, or that protection is silently lost.

**Covered by:** `test_driver_service.py`, `test_vehicle_service.py`, `test_precinct_service.py`, `test_verification_service.py`

---

### V3 — DIP: the Parcel Perfect factory returns concretions
*Cheapest SOLID point in the repo.*

```python
# backend/app/integrations/parcel_perfect.py:1061
def get_pp_client() -> ParcelPerfectClient | MockParcelPerfectClient:
```

Compare with the one right next to it, which does it correctly:

```python
# backend/app/integrations/scan_feed.py:218
def get_scan_feed() -> ScanFeed:      # ← the abstraction
```

Every caller of `get_pp_client()` depends on **both concrete classes**. The two
clients already have matching method sets — the Protocol just was never written.

**Refactor:** define `ParcelPerfectPort(Protocol)`, return it. ~15 lines, zero
behaviour change, and the implementation is copy-paste from `scan_feed.py` in the
same package.

---

### V4 — SRP: three god modules

| File | Size | Concerns tangled in it |
|---|---|---|
| `backend/app/orchestration/phase_service.py` | **1441 lines, 36 functions** | gating · row locking · anchor dispatch · Celery fallback · payload builders · scheduling/date rules · 6 phase wrappers · dispatcher override · position recompute · read queries |
| `backend/app/orchestration/trip_service.py` | 754 — `create_trip` alone is **312 lines** | validation · trip · trailers · stops · consignments · phase plan · lock hash · anchor · response assembly |
| `frontend/dispatcher/app/(app)/trips/new/page.tsx` | **1113 lines, 20 `useState`, 12 components** | 4-step wizard · form state · validation · formatters · presentational components · API calls |

Split plans in §6.

---

## 4. What doesn't look right

### ⚠ Production code imports test fixtures — 11 non-test files

This is the finding most likely to cost marks, because it is visible straight from
the import graph.

```
dispatcher/app/(app)/exceptions/page.tsx        → mockTrips
dispatcher/app/(app)/exceptions/[id]/page.tsx   → mockTrips
dispatcher/lib/hooks/useExceptions.ts           → mockExceptions
driver-pwa/lib/context/AuthContext.tsx          → mockDrivers
driver-pwa/lib/context/TripContext.tsx          → mockTrips
driver-pwa/app/(app)/trips/page.tsx             → mockTrips
driver-pwa/app/(app)/trips/[id]/page.tsx        → mockTrips
driver-pwa/app/(app)/trips/[id]/TripDetailPageClient.tsx → mockTrips
driver-pwa/components/layout/ProfilePanel.tsx   → mockTrips
driver-pwa/lib/utils/precinct-name.ts           → mockPrecincts
driver-pwa/next.config.ts                       → (comment reference only)
```

1,334 lines of fixtures currently ship in the production bundle.

**`useExceptions.ts` is the clearest case:** 15 of its 16 sibling hooks call
`api.*`; it alone returns filtered mock data with **no API path at all**. The
`POST /exceptions` endpoint exists and is tested. The pattern to copy is in the
same directory (`useDrivers.ts`, `useTrips.ts`, `usePrecincts.ts`).

**The driver-pwa contexts are a different case** — they are a deliberate,
documented `IS_DEMO_MODE` dual-mode (`AuthContext.tsx:11-16`). Not sloppy. But the
strategy is an inline `if` rather than two implementations behind one port.
Extracting `AuthPort` + `DemoAuthAdapter` / `SupabaseAuthAdapter` is a textbook
OCP/DIP demonstration and the branching logic already exists to lift.

### Other oddities

| Oddity | Detail |
|---|---|
| Layering break | `api/v1/endpoints/blockchain.py` imports `blockchain/anchor_service` and `blockchain/subject_visibility` directly, skipping orchestration — the only router that breaks the rule in `CLAUDE.md`. |
| Import cycle | `orchestration.phase_service ↔ tasks.blockchain` — real, broken by a function-level import in `_dispatch_anchor`. Documented, but a cycle on a dependency diagram invites a question. |
| Endpoint holding logic | `api/v1/endpoints/dev_triggers.py` is 506 lines with a **155-line handler** (`list_dev_trips`), contradicting the "endpoints thin" rule in `CLAUDE.md`. |
| Shared-file cruft | `.claude/settings.json` (committed) carries ~40 permission entries hardcoded to `/Users/timgultig/...`. |
| Unwired hooks | `.claude/hooks/lint-changed.sh` and `test-summary.sh` are referenced by nothing — not CI, not settings.json. |

---

## 5. Delete list — verified unused, unlikely to be used

All verified by symbol-level reference search, not filename matching.

### Backend — dead models and their entire schema triads

| Delete | Evidence |
|---|---|
| `MerkleBatch`, `MerkleBatchLeaf` (models + 4 schemas + `validate_source_type`) | zero references outside `db/models/` and `schemas/` |
| `TripTemplate` + `TripTemplateBase/Create/Update/Read` | referenced only by the `schemas/__init__.py` barrel |
| `DriverSubstitution` + 3 schemas | same |
| `SlaConfig` | no service, no endpoint; the `useSLAMetrics()` hook that would consume it is `return null` |
| `TrailerGpsSnapshot` + 3 schemas | no writer |
| `BlockchainReceiptReadLegacy` | zero importers |
| `TripBase/Create/Update/Read`, `ParcelBase/Create/Update`, `ConsignmentBase/Create/Update`, `TripTrailerBase/Create/Read` | barrel-only; real traffic goes through `TripCreateRequest` / `TripDetailResponse` |
| `core/rate_limit.py:90 reset_client()` | docstring says "Tests only" — no test calls it |

That is **~19 of the 36 classes in `schemas/trips.py`**.

> **Migration note:** dropping the *models* means an Alembic migration and
> coordination (`CLAUDE.md` § Alembic conflicts). Dropping the *schemas* alone is
> free and can go first. Consider doing schemas in iteration 4 and deferring the
> table drops, or leaving the tables and deleting only the unused Pydantic layer —
> decide as a team before touching `db/models/__init__.py`.

### Frontend — zero-reference modules

```
dispatcher/components/domain/EvidencePacket.tsx        0 refs
dispatcher/components/domain/ExceptionBanner.tsx       0 refs
dispatcher/components/domain/PhaseAnchorSection.tsx    0 refs
dispatcher/components/domain/TimestampWithIcon.tsx     0 refs
dispatcher/lib/hooks/useVerify.ts                      0 refs  ← see note
dispatcher/lib/hooks/useBlockchainReceipts.ts          0 refs
driver-pwa/lib/api/geocode.ts                          only its own 5-test file
shared/lib/types/seal.ts                               0 refs — and its own comment
                                                       describes the deleted H3/H4
                                                       handshake model
```

**`useVerify.ts` note:** it is dead *because* `VerifyButton.tsx:110` re-implements
the same POST inline — with more features (`{ idempotent: true }`, toast,
auto-reset). **Delete the hook; the component is the better version.** Do not
"wire the hook up".

**`geocode.ts` note:** dead, and `driver-pwa/lib/types/evidence-draft.ts:33`
explains why — the reverse-geocode display was removed. The 5 tests still run, so
CI time is being spent testing a function nothing calls.

### Not dead — do not delete these

- `dispatcher/lib/constants/status-meta.ts` is a **one-line deliberate re-export**
  of the shared constant. Correct, keep.
- `driver-pwa/app/sw.ts`, `global-error.tsx`, `next-env.d.ts` are framework entry
  points / generated.
- The 682 "isolated nodes" in `graphify-out/` are **graph-extraction artifacts**,
  not dead code — 657 of them have no `source_file` (unmerged semantic/AST twins).
  The rest are empty `__init__.py`, `postcss.config.js`, and generated Capacitor
  Gradle files. **Do not go hunting for dead code based on that number.**

---

## 6. Split plans for the god modules

### `create_trip` — the easiest 300-line refactor available

The boundaries are **already written as comments in the function**:

```
213  # 1. Validate all referenced records exist before any writes.
236  # 2. Guard against duplicate active order_number within this operator org.
241  # 3. Create the Trip row...
262  # 4. Create TripTrailer rows...
273  # 5. Create TripStop rows...
380  # 6. Build and write the trip's full committed phase plan (parent plan D5/D6).
394  # 7. Compute journey lock hash over the immutable trip parameters.
468  # 8. Assemble and return the response...
```

Eight numbered comments → eight private helpers → a ~40-line orchestrator that
reads like the docstring. **The comments are the proof the split is not arbitrary** —
say that out loud at the demo.

### `phase_service.py` → 4 modules

The module docstring already describes these as separate concerns.

```
phase_service.py     1441
  ├─ phase_gate_rules.py   ~250  _gate_and_load, _is_resolved, _reject_if_*,
  │                              operating_day, is_before_scheduled_day,
  │                              _scheduled_departure   (pure functions, zero
  │                              anchoring concern)
  ├─ phase_anchoring.py    ~180  _dispatch_anchor, _anchor_or_fail_open,
  │                              _anchor_inline_after_dispatch_failure,
  │                              compute_*_canonical_payload
  ├─ phase_advance.py      ~500  the six advance_* wrappers + complete_phase table
  └─ phase_service.py      ~350  _load_*, _finish_phase, override_phase,
                                 recompute_position, next_phase, list_phases
```

**Do this last, and run `pytest` between each individual move.** It is 1441 lines
and `verification_service` imports the payload builders across the seam.

### `trips/new/page.tsx` → `useTripDraft` + 4 step components

20 `useState` calls in one component is the frontend's clearest SRP failure.
A `useReducer`-based draft hook plus one component per wizard step is the standard
answer, and the presentational helpers (`FormCard`, `CardTitle`, `Lbl`,
`ReviewRows`, `ReviewSection`, `MiniField`) should move to `components/ui/`.

---

## 7. Recommended order of work

Every one of these is a **refactor with tests already in place**. Nothing here
requires re-engineering, which is exactly what was asked for.

| # | Action | Principle demonstrated | Effort | Risk |
|---|---|---|---|---|
| 1 | `ParcelPerfectPort(Protocol)`, copy `scan_feed.py` | **DIP** | 30 min | none |
| 2 | Delete the dead schemas/components in §5 | — | 2 h | none (nothing imports them) |
| 3 | `SubjectPolicy` registry replacing both if/elif chains | **OCP** | 3 h | low |
| 4 | `record_and_anchor()` / `AuditedResource` template | **DRY / SRP** | 4 h | low |
| 5 | Split `create_trip` along its own 8 comments | **SRP** | 2 h | low |
| 6 | Split `phase_service.py` into 4 modules | **SRP** | 4 h | **medium** — do last |
| 7 | `useExceptions` → real API; extract `AuthPort` | **DIP** | 3 h | low |
| 8 | `useTripDraft` reducer + 4 step components | **SRP** | 4 h | medium |

**Suggested split across the team:** 1+3+4 are backend and independent of 7+8
(frontend). 2 touches both but is pure deletion. 5 and 6 are both `orchestration/`
and should go to **one** person to avoid merge pain.

**Before starting any of these:** check the sprint ownership issue linked in
`CLAUDE.md`, and confirm nobody else is mid-branch in `orchestration/`.

---

## 8. Verification basis for this document

Everything above was checked against the source at `16f0210`, not inferred from
the knowledge graph alone. Specifically:

- Full AST parse of every module in `backend/app/` for function/class sizes and
  the import graph (cycles, layering).
- Symbol-level reference counting for every deletion candidate — not filename
  matching, which produces false positives on barrel files.
- `grep -c` fingerprints for the duplication claims (§1, fingerprints B–D).
- Full test suite executed: **580 unit + 331 integration passed** (`pytest`,
  3m19s, Postgres + Redis up).

The knowledge graph (`graphify-out/`) was used to locate candidates, then every
finding was confirmed in the actual files. Where the graph and the source
disagreed — notably the "722 isolated nodes = dead code" reading — **the source
won**; see §5, "Not dead".

---

## 9. Change log

| Date | Change |
|---|---|
| 2026-09-02 | Created. Pinned to `16f0210`. Baseline: 580 unit + 331 integration green. |
