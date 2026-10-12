# Backend structure and tech-debt audit

| | |
|---|---|
| **Written** | 2026-10-06 (rev. 2, same day) |
| **Author** | Ciaran (with Claude Code) |
| **Measured at** | `8e2b698` on branch `Ciaran` (merge of PR #67) |
| **Supersedes** | the *status* of [solid-refactor-audit-2026-09-02.md](../solid-refactor-audit-2026-09-02.md); that doc's findings are re-checked in §3 |
| **Scope** | Backend first (file size, purpose, layering). Frontend in §7. Security findings live in [reviews/2026-09-14-security-structure-review.md](../reviews/2026-09-14-security-structure-review.md) and are not repeated here |
| **Revision 2** | Corrected counts, assigned every `phase_service` symbol a home, designed the import graph to be acyclic, merged "split" and "move" into one window per package, and added a behaviour baseline that runs before any cleanup. What changed and why: §10 |
| **Revision 3** | 2026-10-08. Added §0 (progress), §5.6 (naming rules); renamed the planned `orchestration/parcel_perfect/` package to `orchestration/consignments/`; updated §3, §7 and §8 with what phases 0–2 settled |
| **Revision 4** | 2026-10-08. Phase 4 complete: §0 records the parcel_perfect, evidence, fleet, handover, consignments and `app/dev` windows; §5's layout now shows the packages as built, including where they deviate from rev. 3's plan and why; §5.5 records how B8 handles a facade that is also a package |
| **Revision 5** | 2026-10-09. Retain compatibility wrappers while teammates migrate; add the branch acknowledgement and removal checklist (§6.1), the remaining grouping proposal (§5.7), and a linked teammate migration guide. No additional code moves or wrapper removals are claimed by this revision |

> Sections 1–4 are a snapshot measured at `8e2b698`; §0 records what has changed since.
> Numbers come from an AST scan of `backend/app/` (function spans as
> `end_lineno - lineno + 1`) plus `grep` fingerprints. Re-run before quoting them at a demo.

---

## 0. Progress (updated 2026-10-12)

| Phase | Item | Status | Commit(s) |
|---|---|---|---|
| 0 Guardrails | A | **Done**: ruff complexity rules, `check_structure.py` + `structure-baseline.json`, import-linter, all in CI | `dd2498d` (PR #68, merged `3b1f05a`) |
| 1 Behaviour baseline | K (B1–B8) | **Done** | `dd2498d` (PR #68) |
| — CI repairs found on the way | — | **Done**: mypy fix in `exception_service`; settings for the migration step; Supabase auth/role stub so the migration chain applies to plain Postgres | `7364c4b`, `8476db2`, `f751194` (PR #68) |
| 2 Cheap SOLID wins | B `ParcelPerfectPort` | **Done** (now `integrations/parcel_perfect/port.py`, moved in its phase-4 window) | `36c3450` |
| | C endpoint layer skips | **Done**: the 5 non-dev skips now go through orchestration (`receipt_service`, `verify_visible_subject`, core `ManifestNotFoundError` / `ManifestLookupUnsupportedError` / `WaybillNotFoundError`, IDVS client resolved in the service) | `a44904c` |
| | J dead schemas | **Done**: 33 classes and `schemas/sla.py` deleted; models and tables untouched | `b467785` |
| | L `AuthPort` | **Done**: `PasswordAuthPort` (dispatcher) and `OtpAuthPort` + `DriverProfileSource` (driver-pwa), with Supabase, API and demo adapters | `221fb32`, `c4d98e7` |
| | F doc fixes | **Partly**: this revision. `CLAUDE.md` corrections still need the four-reviewer PR | — |
| 3 Name the patterns | D | **Done** 2026-10-12 (stage 6c), after Tim's merge: `SubjectType` registries (`SUBJECT_VISIBILITY_QUERIES`, `SUBJECT_RECONSTRUCTORS`) and shared fleet anchoring (`fleet/canonical.py`); see §3 V1/V2 | this change |
| 4 Package windows | phases | **Done**: `phase_service.py` split into `phases/` (25 modules); `phase_service`, `phase_gate`, `phase_plan` are facades; callers switched. Step 3 skipped for this package (see §6). Logger names are now per module: hosted log filters still to be checked | `f1c9219` |
| | trips | **Done**: `trip_service.py` split into `trips/` (creation, administration, queries); facade; callers switched. Step 3 skipped: `persist_trip` kept whole (see §5.3) | `d1dd771` |
| | exceptions | **Done**: `exception_service.py` split into `exceptions/` (creation, review, queries); facade; callers switched. Step 3 skipped (see §6) | `84c2753` |
| | integrations/parcel_perfect | **Done**: `parcel_perfect.py` split into a 10-module package (errors, timestamps, models, port, waybill_fixtures, client, unassigned_fixtures, manifest_fixtures, mock, factory); `parcel_perfect_port.py` became `port.py`. The package `__init__` is the facade (§5 rule 6). No function over 100 lines, so step 3 had nothing to do | `0e0ff3f` |
| | evidence | **Done**: eight `*_service` modules moved whole into `evidence/`; the old modules are facades. Step 3: only `log_checkpoint` (102 code lines) does more than one job; split in a follow-up commit (`_corroborate_and_assess`) | `bc03250`, `dcc9bf7` |
| | fleet, handover, consignments | **Done** as one batch: eleven modules moved whole (§5 layout); old modules are facades. Two string-constant patch targets that B8 could not see were found and retargeted. Step 3: `update_vehicle` does more than one job and belongs with phase 3 D (`record_and_anchor`); `sync_consignment_from_waybill` is one job, kept whole | `d4a621a` |
| | app/dev | **Done**: dev endpoints, services and schemas moved into `app/dev/` with no facades (no branch imported them). `app.dev` sits in the top layer, so production code cannot import it. All endpoint layer-skip ignores are gone. B8 now resolves patch targets held in module-level string constants | `a2a8847` |
| 4b Remaining grouping | — | Trip reads, review helpers and analytics **done** (stages 3b and 4, below). Planned, not implemented: verification/receipts (§5.7, stage 6). Retain wrappers for any additional moved public paths | — |
| | audit packs (§6.2 stage 5) | **Done** 2026-10-12: Tim's five modules (2,076 lines) moved whole into `orchestration/audit_packs/` as `analysis`, `incident_declarations`, `builder`, `lifecycle` and `access`; empty `__init__`. **No wrappers**: a search of every remote branch found importers only on `dev`, `Ciaran` and `Feat-ValueAddedDocumentation`, and `Chiko` held only a prose mention in the old §5.7 row. Import-linter contract 21 (tier order) added. The six distinct patch targets in the audit-pack tests (nine break cases) were retargeted and each shown to fail when its fake is broken. AST check: all 104 classes and functions identical to `dev`; only imports and two module docstrings differ. B1/B2 snapshots and B3/B4/B6/B8 unchanged. Step 3: nothing needed splitting (`_phase_record` 68 code lines, `build_audit_manifest` 62; see §5.7) | this change |
| | handover route (§6.2 stage 3a) | **Done** 2026-10-12: the route's DB work moved into `orchestration/handover/service.py` (new top tier; contract 16 is now `service` > `receiver_verification` > `capability`). `endpoints/handover.py` has no `select`, `db.execute`, `db.add`, `db.flush` or scalar call; every `commit`, `rollback` and `except SQLAlchemyError` stays in the route at its original point (`service.py` never ends a transaction, and confirm still saves the attempt row before its generic 404). Two domain errors added to `core/exceptions.py` (`HandoverLinkInvalidError` → the generic 404, `HandoverAlreadyConfirmedError` → 409); the confirmation lookup raises `ResourceNotFoundError`. Characterised first: 19 tests added to the existing handover and receiver test files and run green on the unchanged code, then the move. Route signatures, decorators and docstrings unchanged; B1/B2 snapshots unchanged. No log line moved module | this change |
| | resource_service reads (§6.2 stage 3b) | **Done** 2026-10-12: `get_trip_detail` and the two helpers every trip read shares (`_client_names`, `_pp_manifest`) moved whole into `trips/detail.py` (lowest tier, imports no sibling); `list_trips` and `list_trip_history` into `trips/listing.py`, which imports `detail`. `resource_service.py` is now a 15-line wrapper re-exporting the three public names, and is in B8's `FROZEN_FACADES`. All app callers (`endpoints/trips.py`, `phases/gate`, `completion`, `override`, `trips/administration`, `trips/queries`) and `test_exception_claims.py` import the new paths; no patch site existed against `resource_service`. AST check: all 5 definitions identical to `HEAD`, source text included; only imports differ. Import-linter contract 6 also forbids `resource_service`, and contract 22 (`creation` \| `administration` \| `queries` \| `listing` above `detail`) is new; it fails when `detail` imports `listing`. `resource_service` still imports `review_identity` from its flat path until stage 4. `check_structure --update` re-keyed the three over-limit functions (148, 154 and 106 lines, unchanged) to their new files; no function was split | this change |
| | review helpers and analytics coordinators (§6.2 stage 4) | **Done** 2026-10-12: `review_identity` and `review_policy` moved whole into `exceptions/` as shared leaf modules (they import nothing from `creation`, `review` or `queries`); `analytics_service` and `fleet_analytics_service` moved whole into the new `orchestration/analytics/` package as `metrics` and `fleet` (empty `__init__`; the query and calculation code in `app/analytics/` did not move, and the moved modules use absolute imports only). All four old paths are wrappers re-exporting their public names and are in B8's `FROZEN_FACADES`; every app caller and test import uses the new paths, and no patch site existed against any of the four. AST check: all 34 top-level definitions identical to `HEAD`, source text included, and the four moved files are byte-identical to `HEAD` (none of their imports named a moved module, so nothing differs at all). Import-linter: contract 8 also forbids `review_identity` and `review_policy`; contract 23 (`creation` \| `review` \| `queries` above `review_identity` \| `review_policy`), contract 24 (`orchestration.analytics` must not import its two facades) and contract 25 (`metrics` and `fleet` independent) are new. Contracts 23 and 25 each fail when a wrong-direction import is added (`review_policy` importing `creation`; `metrics` importing `fleet`). `check_structure` needed no update: nothing moved was over a limit | this change |
| | vehicle event verification bug fix (§6.2 stage 6a) | **Done** 2026-10-12: `verify_subject(VEHICLE_EVENT)` returned `DB_MISMATCH` for every created event and for any update that changed the device ID, because `fleet/vehicles.py` anchors `pulsit_device_id` as `pulsit_device_id_sha256` (SEC-5) while `VehicleEvent.changed_fields` keeps the plaintext and verification rebuilt from `changed_fields` unchanged. Failing integration tests written first (4 of 6 failed on unchanged code; the "update without device ID" case and the tamper case genuinely passed). **Second defect found by the same tests**: an update that changed a critical and a cosmetic field at once also read as tampered, because `changed_fields` logs both and the anchor carries only the critical diff; fixed in the same function by dropping the cosmetic keys. The canonicalisation now lives in one leaf, `orchestration/fleet/canonical.py` (`canonical_vehicle_fields`), called by `fleet/vehicles.py` and by the verification rebuild. The anchored payload is unchanged: hashes of the four anchored shapes are pinned (`tests/integration/test_vehicle_anchor_payload_pins.py`, `tests/unit/test_fleet_canonical.py`) and were green before the extraction. Receipts anchored before b2348ff (June 2026) carry the plaintext ID; the rebuild picks the rule from the shape of the receipt's `payload_json`, as the trip and phase version checks do, so they keep verifying. 25 contracts unchanged | this change |
| | verification and receipts (§6.2 stage 6b) | **Done** 2026-10-12: `verification_service.py` (675 lines) and `receipt_service.py` moved whole into the new `orchestration/verification/` (empty `__init__`) as `service` (`VerifyOutcome`, `verify_subject`, `verify_visible_subject`, `_latest_receipt`, `_live_artifact_mismatch`), `phase_payloads`, `trip_payloads`, `fleet_events`, `receipts` (all of `receipt_service`) and `errors`. **Wrappers kept** for both old paths, re-exporting every name an importer on `dev`, `Tom` or `codex/submission-docs-cleanup` uses, and both added to `FROZEN_FACADES`. Two definitions did not go where the plan put them: `_hash_payload` lives in `phase_payloads`, not `service`, because `reconstruct_pending_phase_payload` (a `phase_payloads` function) calls it and `service` is the top tier; `_UnsupportedPhasePayloadVersion` is the only definition in `errors.py` because `trip_payloads` and `phase_payloads` both raise it and are siblings, while `_PhaseEvidenceMissing` stayed in `phase_payloads` (lowest module that needs it besides `service`). Import-linter contract 26 (the package may not import the two wrappers) and contract 27 (tier order: `service` > `receipts` \| `trip_payloads` \| `phase_payloads` \| `fleet_events` > `errors`); contract 5 now also covers `verification.**`, so the no-`phase_service`-facade rule did not lapse when the code moved. The C901 ignore became two entries (`phase_payloads.py`: `_reconstruct_phase_event_payload`; `service.py`: `verify_subject`), a relocation, not new debt. 20 patch sites retargeted (14 from `verification_service`, 6 from `receipt_service`); the baseline entry for `_reconstruct_phase_event_payload` (177 lines) moved path. AST check: all 29 definitions identical to `HEAD`; only imports and module docstrings differ. B1/B2 snapshots and B3/B4/B6 unchanged | this change |
| | phase 3 D (§6.2 stage 6c) | **Done** 2026-10-12: no behaviour change. (1) Two registries keyed by `SubjectType` replace the `if`/`elif` chains in `subject_visibility_query` and `verify_subject`; each has a completeness test. Two, not one `SubjectPolicy` object, because one would make `blockchain/` import `orchestration/`. (2) `fleet/canonical.py` gains `vehicle_event_payload`, `driver_event_payload`, `precinct_event_payload` and `anchor_fleet_event`; the six create/update sites in `fleet/{drivers,vehicles,precincts}.py` use them and `verification/fleet_events.py` rebuilds through the same builders. The vehicle rule now keeps only `VEHICLE_CRITICAL_FIELDS` on non-create events. Proof: 8 `compute_payload_hash` golden vectors across the six sites written and green on unchanged code, still green; B3/B4, `test_subject_visibility`, `test_verification_service`, the fleet tests and the 6a tests pass unedited (additions only). `update_vehicle` fell from 108 to 100 lines and no longer needs its `C901` ignore (removed); `verify_subject` fell from complexity 20 to 12 and still needs its | this change |
| 5 Facade removal | — | **Retained during team migration.** 29 facades in `orchestration/` plus the `integrations/parcel_perfect` package `__init__`. Track acknowledgements and removal evidence in §6.1; do not infer completion from this branch passing tests | — |

**Team handoff:** use the [backend structure migration guide](2026-10-09-backend-structure-migration-guide.md)
for current import paths, test-patch examples and handling edits on older branches. This audit remains
the source of truth for planned work and facade retirement (dated plan: §6.2); the guide is its operating checklist,
not a second refactor plan. Branch migration statuses remain unconfirmed until their owners report them.

**Current baselines** (re-measure after every PR):

| Measure | At `8e2b698` | Now (stage 6c, on `bf04077` plus this change) |
|---|---|---|
| Backend suite, slow included | — | **2,880 passed, 4 skipped** (268 of them the slow B7 import checks; stage 5 added one for `audit_packs/__init__`, stage 3a one for `handover/service` plus 19 handover characterisation tests, stage 3b two for `trips/detail` and `trips/listing`, stage 4 five for `exceptions/review_identity`, `exceptions/review_policy` and `analytics/{__init__,metrics,fleet}`, stage 6a 18 tests plus one for `fleet/canonical`, stage 6b seven for the six `verification/` modules and `verification/__init__`, stage 6c 27 tests: registry completeness, `verify_subject` outcomes, fleet anchor pins and round-trips) |
| Backend suite as CI runs it (`-m "not slow"`) | 2,263 passed, 4 skipped | **2,612 passed, 4 skipped** (full run minus the 268 slow checks) |
| dispatcher vitest | 1,480 | **1,500** (at `84c2753`; frontend untouched since) |
| driver-pwa vitest | 821 | **859** (at `84c2753`; frontend untouched since) |
| import-linter contracts | 0 | **27** |
| import-linter ignores, endpoint layer skips | 10 | **0** |
| import-linter ignores, layer order | 8 | **7** (`schemas.dev -> scan_feed` went with `app/dev/`) |
| `orchestration/` top level | 34 modules, one flat folder | **1** real module (`integrity`), 31 facades, 11 packages (`phases`, `trips`, `exceptions`, `evidence`, `fleet`, `handover`, `consignments`, `parcel_trace`, `audit_packs`, `analytics`, `verification`). Tim's five modules made it 13 real modules until stage 5; `resource_service` became a facade in stage 3b, the four stage 4 modules in stage 4, and `verification_service` and `receipt_service` in stage 6b |
| `orchestration/phase_service.py` | 2,289 lines | **119** (facade only) |
| `orchestration/trip_service.py` | 825 lines | **47** (facade only) |
| `orchestration/exception_service.py` | 1,121 lines | **68** (facade only) |
| `integrations/parcel_perfect.py` | 1,485 lines | **81** (`parcel_perfect/__init__.py`, facade only) |
| `schemas/trips.py` | 576 lines | **425** |
| `endpoints/handover.py` | 560 lines | **466** (stage 3a: no database calls left; the work is in `orchestration/handover/service.py`, 370 lines) |

**Follow-ups after phase 4** (none blocks merging): ~~move the DB work out of `endpoints/handover.py` into
`orchestration/handover/`~~ (**done**, stage 3a); update the remaining stale `*_service` path mentions in
endpoint and schema docstrings, together with a B1 snapshot update, because they are in the OpenAPI contract.

**Done since phase 4** (`dcc9bf7`): `log_checkpoint` split; the three `_format_separation` copies replaced
by `core.geo.format_distance` (§5.1); comment and docstring paths updated outside endpoints and schemas;
import-linter contract 20 stops `tasks.blockchain` reaching `phases` except through the anchor modules.

---

## 1. What the marker feedback actually said about code structure

**Iteration 2 code-review marksheet (39.1/56)** — the rows that are about structure:

| Row | Mark | Lost |
|---|---|---|
| Coding structure (framework, best practice) | 2.3 / 4 | 1.7 |
| Object-oriented concepts, classes, encapsulation | 4.8 / 8 | 3.2 |
| Integration, scalability, maintainability, **separation of concerns** | 2.7 / 4 | 1.3 |
| **Total** | **9.8 / 16** | **6.2** |

6.2 of the 16.9 marks lost on the code review sit in these three rows.

**Read the written comment precisely.** The interface sentence is about the
**TypeScript** code: *"The TypeScript code would benefit from a more object-oriented
approach, including clearer separation of concerns through interfaces, more consistent
naming conventions … and stronger error handling."* The same paragraph adds *"use of
object-oriented principles is currently limited"* and *"comments outweigh the actual
code"*. So a backend-only restructure answers the comment-ratio and file-size points
but **not** the interface point. §7 carries the TypeScript half.

**Iteration 3 lecturer meeting** (recorded in the 2 Sept audit §0): SOLID and design
patterns, *refactor where possible, not re-engineer*; SOLID is in the rubric.

**The team's 25 Aug position** ("OO point accurate, intentional"; "comment ratio —
defend it") still holds for *why*-comments, but is weak for a 2,289-line file. The
structural answer is smaller files with one job each, not fewer comments and not
converting services to classes.

---

## 2. Scorecard

`Priority = (Impact + Risk) × (6 − Effort)`, each 1–5. Higher first. The arithmetic is
checked; **I, R and E are judgement calls**, so treat the order as a proposal for the
team, not a measurement.

| # | Item | I | R | E | Priority |
|---|---|---|---|---|---|
| A | Guardrails: ruff complexity rules + AST length/size baseline + `import-linter` + CI gate | 4 | 4 | 1 | **40** |
| K | **Behaviour baseline** (§6 phase 1) — required before B, D, E, G, H | 4 | 4 | 2 | **32** |
| B | `ParcelPerfectPort` (DIP); split `parcel_perfect.py` (1,485 lines) into a package | 4 | 2 | 2 | **24** |
| C | Thin the endpoints: `handover.py`, `dev_*`; fix the api→integration/blockchain skips | 3 | 3 | 2 | **24** |
| D | `SubjectType` registry (OCP) and shared audit-and-anchor helper (DRY) | 3 | 4 | 3 | **21** |
| E | Break up the 25 functions over 100 lines, starting with `persist_trip` (274) | 4 | 3 | 3 | **21** |
| L | **Frontend `AuthPort` + TS interfaces** (the marker's actual interface comment) | 3 | 2 | 2 | **20** |
| F | Documentation drift: `CLAUDE.md` claims, sprint-ownership placeholder, stale audit doc | 2 | 2 | 1 | **20** |
| G | Split `phase_service.py` into `orchestration/phases/` | 5 | 4 | 4 | **18** |
| H | Split `exception_service.py` (1,121) and `trip_service.py` (825) into packages | 3 | 3 | 3 | **18** |
| I | Frontend: production code importing mocks; duplicated API client and idle hooks | 3 | 3 | 3 | **18** |
| J | Delete provably dead schemas (§3, re-verified) | 2 | 1 | 1 | **15** |

**Why G is late even though it is the biggest file:** high effort, medium risk, and A
and K are what make it safe. Doing it first means the hardest move with the least support.

---

## 3. Status of the 2 September refactor targets

| 2 Sep item | Status at `8e2b698` | Evidence |
|---|---|---|
| V3 `ParcelPerfectPort` Protocol | **Done** (`36c3450`) — *was Open at `8e2b698`* | `get_pp_client()` now returns `ParcelPerfectPort` (`integrations/parcel_perfect_port.py`). The package split is still phase 4 |
| V1 `SubjectPolicy` registry | **Done** (stage 6c, 12 Oct) | Two registries keyed by `SubjectType`, not one `SubjectPolicy` object: `SUBJECT_VISIBILITY_QUERIES` in `blockchain/subject_visibility.py` (eight query builders) and `SUBJECT_RECONSTRUCTORS` in `orchestration/verification/service.py` (five reconstructors, returning one uniform result or `None`; `verify_subject` turns the two typed errors into outcomes once). A single object would have to hold both the tenant query and the payload rebuild, so `blockchain/` would import `orchestration/` and break the layer order (contract 1). Each registry sits beside an explicit set of types it does not handle (`NEVER_VISIBLE_SUBJECT_TYPES`, empty; `UNVERIFIABLE_SUBJECT_TYPES`: vehicle, driver, audit pack), and `test_subject_policy_registries.py` fails until every `SubjectType` member is in one or the other. Both `if`/`elif` chains are gone; every `VerifyOutcome` field is pinned per subject type and path by `test_verify_subject_outcomes.py`, written first |
| V2 shared audit-and-anchor helper | **Done** (stage 6c, 12 Oct) | The six anchor payloads (driver, vehicle, precinct, create and update) are built by `vehicle_event_payload`, `driver_event_payload` and `precinct_event_payload` in `orchestration/fleet/canonical.py`, from the event row, and the verification package rebuilds through the same three functions, so anchoring and verification cannot drift again. `anchor_fleet_event` anchors a flushed event and sets `blockchain_receipt_id`; the canonicalise-before-hash hook is the 6a device-ID rule (`canonical_vehicle_fields`). `"changed_by_user_id": str` now appears 3× (once per builder) instead of 9×. Named `anchor_fleet_event`, not `record_and_anchor`, because it does not create the event: that differs per entity (a precinct stamps `created_at` itself, a vehicle update logs more than it anchors). The caller passes its own `anchor_subject`, so the existing `fleet.<module>.anchor_subject` test patches keep applying. All eight payload hashes (six sites; vehicle create has two cases) were pinned before the refactor and are unchanged |
| V4 split `create_trip` | **Partly** | now `persist_trip`, still **274 lines** — longest function in the backend |
| V4 split `phase_service.py` | **Worse** | 1,441 → **2,289** lines. `phase_gate.py` and `phase_plan.py` were extracted, but arrival, corroboration and position findings added more than was removed |
| V4 split `trips/new/page.tsx` | **Done in effect** | 1,113 → 485 lines via extracted components; the proposed reducer was not built |
| `useExceptions` → real API | **Done** | hook calls the API; no mock reference |
| **`AuthPort` (frontend DIP, same 2 Sep row 7)** | **Done** (`221fb32`, `c4d98e7`) — *was Open at `8e2b698`; omitted from rev. 1* | At `8e2b698`: both `dispatcher/` and `driver-pwa/` `lib/context/AuthContext.tsx` call `supabase.auth.*` directly (session, sign-in, OTP, sign-out) |
| Production code importing mocks | **Open** | **8** non-test files import a `mocks` module; **7** excluding `dispatcher/lib/trips/__fixtures__/preview.ts`. (Rev. 1's "10" counted text matches, including a comment and repeated imports). Still 8 after phase 2 L: `AuthContext` stopped importing mocks, and the new demo adapter `DemoDriverProfileSource.ts` imports `MOCK_DRIVER`, which is where demo data belongs |
| Delete dead schemas | **Done for schemas** (`b467785`); tables are an open decision (§8) — *was Partly stale* | At `8e2b698`: `MerkleBatch`, `TripTemplate`, `SlaConfig` and the legacy receipt schemas have no application consumers. `TrailerGpsSnapshot` is **live** (written by `phase_service` and `corroboration_service`). `DriverSubstitution`: the `db/models/locations.py:29` "reference" is a **comment**; real references are in tests only, so it is an app-dead candidate, but deleting it means deleting or rewriting those tests |
| Sept fingerprint E (test baseline 580 passed / 4 skipped) | **Unverified** | historical figure; the suite was not run for this audit. Phase 1 (§6) records a fresh baseline |

**Net:** September's feature work grew the god modules faster than cleanup shrank them.
That is the argument for A (guardrails) first.

---

## 4. Findings by theme

### 4.1 File size and purpose

"Funcs (top-level)" is what rev. 1 reported; the second figure includes methods and
nested functions.

| File | Lines | Funcs (top-level / all) | Comment share | Primary-purpose test |
|---|---|---|---|---|
| `orchestration/phase_service.py` | 2,289 | 57 / 60 | 40% | Fails — loaders, gate, scheduling rules, anchoring, 7 phase handlers, payload builders, findings, override, queries |
| `integrations/parcel_perfect.py` | 1,485 | 9 + 16 classes / 29 | 21% | Fails — HTTP client, mock client, response models, factory, polling |
| `orchestration/exception_service.py` | 1,121 | 20 / 20 | 28% | Fails — raise, review/claim, batch review, history, listing |
| `orchestration/trip_service.py` | 825 | 14 / 15 | 28% | Borderline — `persist_trip` is 274 lines |
| `orchestration/action_location_service.py` | 706 | 13 / 13 | 31% | Borderline |
| `schemas/trips.py` | 576 | 2 + 39 classes / 4 | 14% | Barrel of unrelated request/response models |
| `api/v1/endpoints/handover.py` | 560 | 12 / 12 | 13% | Failed "endpoints thin" — 18 `db.*()` calls, 7 `select()`. **Resolved 2026-10-12 (stage 3a)**: 0 and 0; now 466 lines, DB work in `handover/service.py` |

Comment share = (comment lines + docstring lines) ÷ non-blank lines, truncated.

Totals over **159 modules**: 769 functions (all, including nested), **63 over 60 lines,
25 over 100**. Longest: `persist_trip`, 274.

**Rule:** if you cannot describe the file without the word "and", split it. Line count
is the alarm that triggers a review, not the thing that decides the cut. Split by
responsibility and by dependency direction (§5), never into arbitrary fragments.

### 4.2 Layering (`CLAUDE.md`: endpoints → orchestration → integrations → db)

Clean: `integrations`, `blockchain`, `crypto` and `core` import nothing upward. `db/`'s
only import from elsewhere in `app/` is `core.config` (in `db/session.py`) —
technically a break of "db never imports app", practically harmless.

| Violation | Where | Severity |
|---|---|---|
| endpoint → integration, skipping orchestration | `trips.py`, `pp.py` → `parcel_perfect`; `handover.py` → `idvs` | Real |
| endpoint → integration (dev tools) — *missed in rev. 1* | `dev_tracker.py` → `pulsit` (1); `dev_triggers.py` → `mock_state`, `parcel_perfect`, `scan_feed` (3); `dev_pulsit.py` → `pulsit` (1) — **5 imports** | Lower: dev-only, but moves with `app/dev/` |
| endpoint → blockchain, skipping orchestration | `blockchain.py` → `anchor_service`, `subject_visibility` | Real (known, 2 Sept) |
| endpoints holding DB queries | `handover.py` **18** `db.*()` / 7 `select()`; `dev_triggers.py` **13** / 10; `dev_pulsit.py` **3** / 3 | Was real for `handover.py`: **resolved in stage 3a** (0 queries; DB work in `handover/service.py`). Dev tools lower, now in `app/dev/`. (Rev. 1's 19/22/6 used an unstated method) |
| import cycle `phase_service` ↔ `tasks.blockchain`, and `phase_service` → `verification_service` → `phase_service` | broken today by function-level imports at `phase_service.py:438, 489, 528` and `tasks/blockchain.py:51, 101` | §5.2 removes it structurally |

### 4.3 Patterns the marker can be pointed at (defend these, do not disturb them)

`ScanFeed` Protocol (DIP), `_HederaAdapter` (DIP), per-phase request schemas (ISP), the
`complete_phase` dispatch table (OCP — **seven** handlers, including arrival),
`integrity.py` (SRP), `core/limits.py` (Strategy), `phase_gate.py` (one derived rule
shared by schema and service).

### 4.4 Tooling gap

No `ruff.toml`, `pyproject.toml` or import-linter config in the repo. CI runs bare
`ruff check .` and `mypy .`, so only ruff's default rules apply. Nothing measures
function length, complexity, file size or import direction. ESLint is configured in all
three frontend apps but without `max-lines`/`complexity`.

### 4.5 Directory structure of `orchestration/`

34 modules, 12,356 lines, 39% of the backend, one flat folder mixing trip lifecycle,
phase machine, exceptions, location evidence, handover, fleet CRUD, Parcel Perfect
sync, analytics and dev tooling. Dev tooling (`dev_rig_service`, `dev_truck_service`,
`endpoints/dev_*.py`, `schemas/dev.py` at 497 lines) ships inside the production layers.

---

## 5. Recommended structure

**Principle:** keep the layer-first top level (`api/ → orchestration/ → integrations/,
blockchain/, crypto/, storage/ → db/`). Add **domain sub-packages inside** the large
layers. No vertical slices — that is a re-engineer, which the lecturer advised against.

As built (rev. 4). Where this differs from rev. 3's plan, the reason is under the tree.

```
backend/app/orchestration/
├── trips/            creation.py · queries.py · administration.py · listing.py · detail.py (stage 3b; detail is the lowest tier)
├── phases/           (§5.1 — 25 modules)
├── exceptions/       creation.py · review.py · queries.py · review_identity.py · review_policy.py (stage 4; the last two are shared leaves)
├── analytics/        metrics.py · fleet.py (stage 4; the dispatcher and fleet analytics coordinators)
├── verification/     service.py · receipts.py · trip_payloads.py · phase_payloads.py · fleet_events.py · errors.py (stage 6b; service is the top tier)
├── evidence/         artifacts · checkpoints · corroboration · action_location · geofence ·
│                     location · proximity · road_check (existing *_service modules, moved whole)
├── fleet/            drivers.py · vehicles.py · precincts.py
├── handover/         capability.py · receiver_verification.py · service.py (the receiver routes' DB work, stage 3a)
├── consignments/     sync · scans · waybill_lookup · manifest_snapshot · manifest_import ·
│                     manifest_reads (consignment, scan, pp_lookup, pp_manifest, pp_manifest_service
│                     and manifest services, moved whole; named for the job, not the vendor, §5.6)
└── (flat: integrity; plus the 31 facades)

backend/app/integrations/parcel_perfect/   __init__ (facade) · errors · timestamps · models · port ·
                                           waybill_fixtures · unassigned_fixtures · manifest_fixtures ·
                                           client · mock · factory
backend/app/dev/                           endpoints/ (triggers, pulsit, tracker) · services/ (rig, truck) ·
                                           schemas.py; routers still mounted only behind the dev flags
```

**Deviations from rev. 3, and why:**
- `integrations/parcel_perfect/` has ten modules, not five. A single `mock.py` would have been about
  1,000 lines, most of it demo data, so the fixtures got three modules of their own, and errors and
  timestamps became leaves the rest import.
- `handover/` gained its `service.py` in stage 3a (2026-10-12), after the move window: moving the database work
  out of `endpoints/handover.py` changed code, not just its location, so it was a separate change. The
  stage's acceptance line, "no DB calls in the route module", is read as no *queries or writes*: the route
  still owns `commit`, `rollback` and `except SQLAlchemyError`, at the same points as before, because
  orchestration never commits anywhere in this codebase and the confirm route must save the attempt row
  before raising its generic 404. `service.py` is the top tier of `handover/`; it raises domain errors and
  never `HTTPException`. `receiver_verification.py` is not named `verification.py` so it cannot be mistaken for
  `orchestration/verification_service.py` (Hedera verification).
- `consignments/` also took `manifest_service` (role-aware manifest reads), which rev. 3's list missed.
- `app/dev/` has no facades: no open branch imported the old paths, and facades there would have
  imported upward from production layers.

**Package rules (these are what keep the graph acyclic):**

1. **`__init__.py` in every `orchestration/` sub-package stays empty.** No re-exports.
   `resource_service` imports `phases.blocking`; if `phases/__init__.py` imported
   `phases.gate`, which imports `resource_service`, that is a cycle created by the
   package itself.
2. **The old flat module is the facade.** `orchestration/phase_service.py` (likewise
   `trip_service.py`, `exception_service.py`) becomes a re-export of the moved names.
   **New modules never import the facade.** Imports only run old → new.
3. **Move leaves first.** A module moves only after everything it depends on has moved,
   so a new module can only ever import other new modules or code outside the package.
4. **Names are kept in move commits**, including leading underscores, so the facade and
   test references keep resolving. Dropping underscores on names that are now
   cross-module (`_gate_and_load` → `gate_and_load`) is a separate, optional commit.
5. **Lazy imports stay lazy in the move commit.** Promote them to module level only in a
   later commit, after the import check (§6 phase 1, check B7) proves the cycle is gone.
6. `integrations/parcel_perfect/` is the exception to rule 1: the package replaces the
   module path, so its `__init__.py` *is* the facade. Safe because `integrations/`
   imports nothing upward.

### 5.1 `phase_service.py` → `orchestration/phases/`: every symbol has a home

57 top-level functions and 8 module constants. `logger` is recreated per module
(`logging.getLogger(__name__)`), which changes the logger *name* — see check B6.

**Tier 0 — leaves (no imports inside `phases/`)**

| Module | Symbols | External deps | Notes |
|---|---|---|---|
| `payloads.py` | `PHASE_PAYLOAD_VERSION_V2`, `_phase_payload_base`, `_override_commitment`, `compute_activation_canonical_payload_v2`, `compute_loading_canonical_payload_v2`, `compute_departure_canonical_payload_v1`, `compute_departure_canonical_payload_v2`, `compute_in_transit_canonical_payload_v2`, `compute_arrival_canonical_payload_v2`, `compute_unloading_canonical_payload_v2`, `compute_confirmation_canonical_payload_v1`, `compute_confirmation_canonical_payload_v2`, `compute_override_canonical_payload_v2` | `hashlib` | Pure, no DB — 10 builders + 2 internals move **together**. **Move first.** `verification_service` switches its import here in the same commit |
| `loaders.py` | `_load_trip_for_driver`, `_load_trip_for_dispatcher`, `_load_phase_event` | DB | Named `loaders`, not `loading`, to avoid confusion with the LOADING phase |
| `state.py` | `_is_resolved`, `recompute_position` | DB | The ledger→position rule. `trip_service` imports `recompute_position` from here, not the facade |
| `artifacts.py` | `_assert_artifacts_belong_to_trip` | DB | Artifact ownership guard (loading, departure, arrival, confirmation) |
| `driver_position.py` | `_record_driver_position` | — | Stamps the driver's fix on every phase event |
| `seals.py` | `_normalized_seal`, `_find_departure_for_leg` | DB | Seal continuity (departure, arrival) |
| `scheduling.py` | `_SCHEDULED_DATE_FORMAT`, `operating_day`, `is_before_scheduled_day`, `_scheduled_departure`, `_other_trips_for_driver`, `_reject_if_not_due`, `_reject_if_another_trip_underway`, `_reject_if_an_earlier_trip_is_due` | DB | Activation day rules. **Not "rules only"** — they read the DB; the name says what they decide, not that they are pure |
| `findings.py` | `_SEPARATION_KM_THRESHOLD_METRES`, `_format_separation`, `_phone_tracker_separation_metres`, `_raise_position_disagreement_if_unrecorded`, `_raise_trailer_decoupling_if_unrecorded`, `_raise_scan_shortfall_if_unrecorded`, `_record_seal_finding`, `_seal_unverified_severity` | DB, `core.geo`, `core.realtime`, `review_policy` | System-detected exceptions in one place. Afterwards `action_location_service` *could* import `_format_separation` instead of duplicating it (its comment says the duplicate exists only because of the cycle) — separate commit |
| `anchor_execution.py` | `_PHASE_RECEIPT_TYPES`, `receipt_type_for`, `anchor_phase_event`, `_anchor_or_fail_open` | DB, `blockchain.anchor_service` | What the Celery task runs. **Must not import `tasks/`** |
| `blocking.py` | today's `orchestration/phase_gate.py`, moved whole | — | Renamed so it is not confused with `gate.py`. Kept separate from `gate.py`: merging them would create `resource_service ↔ phases.gate` |
| `plan.py` | today's `orchestration/phase_plan.py`, moved whole | — | |

**Tier 1**

| Module | Symbols | Imports from `phases/` | External |
|---|---|---|---|
| `queries.py` | `current_phase_event`, `next_phase`, `list_phases` | `loaders`, `state` | — |
| `gate.py` | `_gate_and_load` | `loaders`, `state`, `blocking` | `resource_service.get_trip_detail`. **Includes DB loading** (it loads trip, event and detail before checking order) |
| `anchor_dispatch.py` | `_BACKGROUND_ANCHOR_TASKS`, `_dispatch_anchor`, `_schedule_anchor_after_dispatch_failure`, `_retain_anchor_task`, `_anchor_phase` | `anchor_execution` (`receipt_type_for`) | `tasks.blockchain` — **lazy**, as today |
| `anchor_recovery.py` | `recover_phase_anchor` | `anchor_execution` | `verification_service` — lazy, as today |
| `completion.py` | `_finish_phase` | `findings`, `state` | `action_location_service`, `resource_service`, `core.realtime` |

**Tier 2**

| Module | Symbol | Imports from `phases/` |
|---|---|---|
| `advance_activation.py` | `advance_activation` | `gate`, `scheduling`, `driver_position`, `payloads`, `anchor_dispatch`, `completion` |
| `advance_loading.py` | `advance_loading` | `gate`, `artifacts`, `driver_position`, `findings`, `payloads`, `anchor_dispatch`, `completion` |
| `advance_departure.py` | `advance_departure` | `gate`, `artifacts`, `seals`, `driver_position`, `payloads`, `anchor_dispatch`, `completion` |
| `advance_in_transit.py` | `advance_in_transit` | `gate`, `driver_position`, `payloads`, `anchor_dispatch`, `completion` |
| `advance_arrival.py` | `advance_arrival` | `gate`, `artifacts`, `seals`, `findings`, `driver_position`, `payloads`, `anchor_dispatch`, `completion` |
| `advance_unloading.py` | `advance_unloading` | `gate`, `driver_position`, `payloads`, `anchor_dispatch`, `completion` |
| `advance_confirmation.py` | `advance_confirmation` | `gate`, `artifacts`, `driver_position`, `payloads`, `anchor_dispatch`, `completion` |
| `override.py` | `override_phase` | `loaders`, `state`, `payloads`, `anchor_dispatch` |

**Tier 3**

| Module | Symbols | Imports from `phases/` |
|---|---|---|
| `service.py` | `_WrapperFn`, `_WRAPPER_BY_PHASE_TYPE`, `complete_phase` | `loaders`, all seven `advance_*` |

Count check: 12 + 3 + 2 + 1 + 1 + 2 + 7 + 7 + 3 (tier 0) + 3 + 1 + 4 + 1 + 1 (tier 1)
+ 8 (tier 2) + 1 (tier 3) = **57 functions**; constants: `PHASE_PAYLOAD_VERSION_V2`,
`_PHASE_RECEIPT_TYPES`, `_BACKGROUND_ANCHOR_TASKS`, `_SEPARATION_KM_THRESHOLD_METRES`,
`_SCHEDULED_DATE_FORMAT`, `_WrapperFn`, `_WRAPPER_BY_PHASE_TYPE`, plus per-module `logger`
= **8**.

**Why `_finish_phase` is in `completion.py`, not `service.py`:** all seven `advance_*`
call it, and `service.py` imports all seven `advance_*`. Putting it in `service.py`
creates `service → advance_* → service`.

### 5.2 Why the anchoring cycle actually goes away

Today: `phase_service → (lazy) tasks.blockchain → (lazy) phase_service`, and
`phase_service → (lazy) verification_service → phase_service`. Moving all anchoring into
one `anchoring.py` (rev. 1's plan) **keeps both cycles**, just inside a new module. The
three-way split breaks them:

```
tasks.blockchain ──► phases.anchor_execution ──► blockchain.anchor_service
       │
       └──────────► phases.anchor_recovery ──► phases.anchor_execution
                                │
                                └──► verification_service ──► phases.payloads (leaf)

phases.anchor_dispatch ──► tasks.blockchain          (nothing above points back here)
```

No arrow returns to `anchor_dispatch`, and `verification_service` reaches only the
`payloads` leaf, not the facade. Enforced by import-linter (§6, phase 0).

The cycle is gone, but the lazy `phases.anchor_dispatch → tasks.blockchain` import is
still an orchestration → tasks layer violation. It stays as an ignore in both the layer
contract and the `phases-tier-order` contract (import-linter follows the chain through
`tasks.blockchain` to `anchor_recovery`, a same-tier sibling).

### 5.3 `trip_service.py` → `orchestration/trips/`

| Module | Symbols |
|---|---|
| `creation.py` | `ManifestCargo`, `NewTrip`, `find_live_trip_for_manifest`, `_manifest_conflict`, `_sync_cargo_entry`, `_fetch_driver`, `_fetch_vehicle`, `_generate_trip_reference`, `_build_phase_events`, `create_trip`, `persist_trip` |
| `administration.py` | `_CANCELLED_BY_PREFIX`, `cancel_trip` |
| `queries.py` | `get_active_trip_for_driver`, `_driver_view`, `list_trips_for_driver`, `get_own_trip_detail_for_driver` |

`persist_trip` (274 lines, about 180 of code) is **kept whole** in `creation.py`. Decided
after the move: it is one job (persist a new trip), its numbered step comments make it
readable as it stands, and it now sits in a file with a single purpose. It stays in the
structure baseline, so it still cannot grow.

### 5.4 `exception_service.py` → `orchestration/exceptions/`

| Module | Symbols |
|---|---|
| `creation.py` | `_CRITICAL_TYPES`, `_CLIENT_REPORT_ID_INDEX`, `_DRIVER_REPORT_TRACKER_TIMEOUT_SECONDS`, `_driver_report_assessment`, `_resolve_phase_context`, `pick_breakdown_vehicle`, `_resolve_breakdown_vehicle`, `_find_by_client_report_id`, `raise_exception` |
| `review.py` | `_read_with_trip`, `_lock_for_review`, `_read_with_names`, `_enqueue_claim_changed`, `review_exception`, `claim_exception`, `release_exception`, `review_exceptions_batch` |
| `queries.py` | `_HISTORY_REVIEW_STATUSES`, `_TripContext`, `_load_trip_contexts`, `_to_list_item`, `_exception_read_query`, `_SEVERITY_RANK`, `list_review_queue`, `list_exception_history`, `get_exception_detail` |

`exceptions/creation.py` imports `current_phase_event` from `phases.queries`, not the facade.

### 5.5 Compatibility facades

- Each facade lists its re-exports in `__all__` and carries a one-line docstring naming
  the package it fronts.
- **A facade preserves imports, not monkeypatching.** A moved function looks up names
  in its *new* module's globals, so `monkeypatch.setattr(phase_service, "_gate_and_load", …)`
  silently stops affecting `advance_arrival`. Every move commit retargets patches to
  the module that *uses* the name (`phases.advance_arrival._gate_and_load`,
  `phases.completion.enqueue_event`). Test patches through a facade are then banned by
  check B8. Open branches that add new facade patches will hit the same trap — say so
  in the merge announcement. Where a name is looked up in several modules, a shared
  fixture needs one patch per module (`_gate_and_load` in each `advance_*` it drives).
  `phase_gate` and `phase_plan` are facades too; they had no patch sites, and are in
  `FROZEN_FACADES` so none can be added.
- **Removal is a condition, not a date.** Keep wrappers while teammates migrate. Delete a
  facade only when reference checks find no remaining consumer on `dev` or any maintained
  open branch, and every affected branch owner has confirmed integration of the move and
  migration of imports, patches and pending implementation edits. Record the evidence in
  §6.1. A search of one checkout alone cannot establish this; search aliases and dynamic
  references too. Historical docs and the compatibility checks themselves are not consumers.
- **B8 must match facades exactly, not by prefix.** For `integrations/parcel_perfect/`
  the facade and the package share a path, so adding it to `FROZEN_FACADES` must ban
  `app.integrations.parcel_perfect.X` but still allow `app.integrations.parcel_perfect.client.X`.
  **Done** (`0e0ff3f`): a target counts as "through the facade" only if its first segment after
  the facade is not a module in the facade's own directory, read from disk. For plain-module
  facades this is the old prefix match.
- **import-linter cannot ban a package importing its own `__init__`.** A `forbidden` contract
  does not see it (checked). A `layers` contract with `containers` catches it indirectly, because
  the facade imports every sibling, for every tier except the top one; an AST test
  (`tests/unit/test_parcel_perfect_package.py`) covers the rest.
- **B8 also resolves string constants** (`a2a8847`): `_ANCHOR = "app....anchor_subject"; patch(_ANCHOR)`
  hid about ten patch calls from the scanner until the fleet window found them by hand.
- **A facade must not re-export a name that is rebound with `global`** (`parcel_perfect`'s
  `_cached_token`): the facade would hold a stale copy, and a test assigning through it would test
  nothing.

### 5.6 Naming rules

1. **Name by domain job, not technology.** Packages by domain (`trips/`, `phases/`,
   `consignments/`); modules by responsibility (`creation`, `review`, `queries`,
   `loaders`). Inside a package, drop the `_service` suffix; the package gives the context.
2. **Move commits never rename.** Names are kept, leading underscores included, so imports,
   facades and test references keep resolving. Renames are separate commits, or skipped.
3. **Vendor names only at the integration edge.** The Parcel Perfect client, its response
   models (`PPWaybillResponse` …), errors and `PP_*` settings keep the name: that code *is*
   Parcel Perfect. `ParcelPerfectPort` keeps it too, because its types are PP-shaped.
   Anything outside `integrations/` is named for the job. **No new `PP*` names outside
   `integrations/`.** Phase 2 C followed this: its three new core exceptions are
   vendor-neutral. The existing `PP*` exceptions in `core/` stay until a rename is worth it.
4. **Stored and hashed names are frozen.** `pp_manifest` and `pp_manifest_snapshot_sha256`
   are keys *inside* the journey-lock payload (`crypto/hashing.py`), which is hashed and
   anchored on Hedera. Renaming them makes every existing trip fail verification; they can
   only change through a new, versioned payload for new trips. DB columns
   (`parcel_perfect_reference`, `pp_*`) and API fields need a migration plus an API-contract
   change (B1). When a second parcel system arrives, add `source_system` /
   `source_reference` columns rather than renaming these.

**Supporting more than one parcel system** is a two-step path. Step 1 (done) is
`ParcelPerfectPort`: callers depend on an interface, and real and mock are interchangeable.
Step 2, when a second system is real, is a neutral port (e.g. `WaybillSource` with neutral
`Manifest` / `Waybill` types), Parcel Perfect wrapped as one adapter, and `orchestration/`
moved onto the neutral types. PP models are used in 15 modules today, so step 2 is not
worth doing ahead of need; rule 3 keeps it cheap.

### 5.7 Remaining grouping (planned, not yet implemented)

Keep this work in the existing audit rather than starting a competing architecture plan.
The current paths in §5 and the migration guide remain valid until each move actually lands.
Proposed filenames below describe the intended responsibilities; review the import graph before
fixing the exact split. These are separate package windows, not permission to move every file at once.

| Current implementation | Proposed home | Scope and sequencing |
|---|---|---|
| `analytics_service.py`, `fleet_analytics_service.py` | `orchestration/analytics/metrics.py`, `fleet.py` | **Done 2026-10-12 (stage 4).** Moved whole; wrappers kept. Query and calculation code stays in `app/analytics/`; the moved modules use absolute imports because `app.analytics` and `app.orchestration.analytics` are different packages. `metrics` and `fleet` share no code, enforced by import-linter contract 25. Nothing was split: they were already cohesive |
| `verification_service.py`, `receipt_service.py` | `orchestration/verification/` | **Done 2026-10-12 (stage 6b).** Moved whole, wrappers kept. `receipts` is all of `receipt_service`; `service` holds `VerifyOutcome`, `verify_subject` and `verify_visible_subject`; `trip_payloads`, `phase_payloads` and `fleet_events` hold the per-subject rebuilds and legacy generation checks; `errors` holds `_UnsupportedPhasePayloadVersion`, the one definition `trip_payloads` and `phase_payloads` both need. Tier order is import-linter contract 27, and contract 26 stops the package importing the two wrappers. Phase 3 D (`SubjectPolicy` registries, shared fleet anchoring) is stage 6c and builds on this layout; all legacy hash generations are untouched (B3/B4 green, no snapshot change) |
| `resource_service.py` | `orchestration/trips/` | **Done 2026-10-12 (stage 3b).** Moved whole: `detail.py` (`get_trip_detail` plus the `_client_names` and `_pp_manifest` helpers both reads share) is the lowest tier and imports no sibling; `listing.py` (`list_trips`, `list_trip_history`) builds on it; tier order is import-linter contract 22. `resource_service.py` stays as a wrapper for the three public names. It still imports `review_identity` from its flat path until stage 4 moves that module |
| `review_identity.py`, `review_policy.py` | `orchestration/exceptions/` | **Done 2026-10-12 (stage 4).** Moved whole as shared leaf modules; wrappers kept. Neither imports `creation`, `review` or `queries`, enforced by import-linter contract 23 (the three coordinators sit above the two leaves). `exceptions/__init__.py` stays empty. `phases/`, `evidence/`, `consignments/`, `handover/` and `trips/` import `exceptions.review_policy` directly; none of those contracts broke |
| Tim's `audit_pack_access`, `audit_pack_analysis`, `audit_pack_builder`, `audit_pack_service`, `incident_declaration_service` (1,841 lines on `Feat-ValueAddedDocumentation`) | `orchestration/audit_packs/` | **Done 2026-10-12 (stage 5).** Moved whole, without wrappers (the exception to the wrapper rule below, as for `app/dev`: no importer outside `dev`, `Ciaran` and `Feat-ValueAddedDocumentation`). Homes: `analysis`, `incident_declarations`, `builder`, `lifecycle` (the old `audit_pack_service`: issue, revoke, list, preview, download) and `access`; tier order is enforced by import-linter contract 21 (`access` > `lifecycle` > `builder` > `analysis` \| `incident_declarations`). `build_audit_manifest` assessed, no split: 62 code lines (74 with docstring and comments), a pipeline of single calls (load the graph, resolve scope, build each section, assemble, derive observations) after Tim's split into loaders and section builders. `_phase_record` (68 code lines, 76 with docstring and comments) turns one phase event into one record; it also holds two separable rules, the anchor reconciliation and the evidence-tier choice. Both functions are under the 100-line limit, so no split was needed; extracting those two rules is an optional later commit, not part of the move. `access` imports `verification_service`, so stage 6 must retarget that one import (`access.py`) when it moves |
| `integrity.py` | Keep as a small shared module | Database uniqueness-error decoding supports multiple domains; a new folder or a function split adds no useful separation |

Receipts concern trips, phases and fleet events, so they belong with verification, not exception
review. Keep Hedera submission/transport in `app/blockchain/`, hashing in `app/crypto/` and storage
I/O in `app/storage/`. Grouping within orchestration does not collapse these layers.

For every additional move: update callers and test patches together, add a thin wrapper for the old
path, extend the migration-guide inventory and B8 protection, update import contracts without weakening
their dependency rules, and record fresh guardrail results. Keep behaviour changes separate from moves.
Do not remove an existing wrapper while a teammate is relying on it; phase 5 can proceed for eligible
wrappers independently of the remaining grouping work.

---

## 6. Phased plan

| Phase | When | Work | Exit check |
|---|---|---|---|
| **0 — Stop the bleeding** | Now, small PR | **A:** `ruff` config enabling `C901` (complexity), `PLR0915` (statements), `PLR0913` (arguments). These **do not measure physical length**, so add `scripts/check_structure.py`: an AST scan that fails on any new function > 100 lines, on growth of any function already over 100, and on growth of any file in a committed `structure-baseline.json` (the seven files in §4.1). `import-linter` contracts: the `CLAUDE.md` layer order; `app.orchestration.phases` may not import `app.orchestration.phase_service`; tier order inside `phases/` (§5.1); today's violations (§4.2) listed as ignored. Wire all three into CI | CI fails on (a) a new 101-line function, (b) `persist_trip` growing by one line, (c) `phase_service.py` growing, (d) a new `integrations → orchestration` import |
| **1 — Behaviour baseline (K)** | Before any of B, D, E, G, H. One PR, tests only | Checks B1–B8 below. Pin outputs at `8e2b698`-equivalent behaviour on `dev` | B1–B8 committed and green; fresh pass/skip counts recorded in the PR |
| **2 — Cheap, visible SOLID wins** | Alongside features | **B:** `ParcelPerfectPort`. **L:** `AuthPort` in `frontend/shared/` + Supabase/demo adapters; typed interfaces for the shared API client. **J:** delete verified-dead schemas (schemas only). **F:** doc fixes. **C:** route the api → integration/blockchain skips through orchestration | Each its own small PR; B1–B8 green |
| **3 — Name the patterns** | Alongside features | **D (done 12 Oct, stage 6c; two registries and `anchor_fleet_event`, see §3 V1/V2):** `SubjectPolicy` registry; shared `record_and_anchor` with a canonicalise-before-hash hook (the `pulsit_device_id` POPIA case in `vehicle_service.py` must survive) | B3, B4 and `test_subject_visibility`, `test_verification_service`, fleet tests green |
| **4 — Package windows** | One package at a time, at agreed checkpoints | Per package, in this order: **phases → trips → exceptions → integrations/parcel_perfect (absorbing `parcel_perfect_port.py` as `port.py`) → evidence, fleet, handover, orchestration/consignments → app/dev**. Inside each window: (1) move commits, leaves first, one tier per commit, facade + patch retargets in the same commit; (2) switch in-repo callers to new paths; (3) decompose the long functions now living in the package, only where a function does more than one job; the 100-line limit is a tripwire, not a target. Skipped so far: the phases functions (each is one handshake with 50–80 lines of code, long because of required "why" comments, so splitting them would scatter one purpose), `persist_trip` (one job; see §5.3), `raise_exception` (98 lines of code; its insert-once savepoint block carries the B5 duplicate-report guarantee, and one extraction would not take it under 100) and `review_exception` (58 lines of code, long from its docstring). `list_exception_history` (69 lines of code) could optionally lose its predicate builder as a small separate commit; (4) promote lazy imports only if B7 still passes | After **every commit**: full `pytest` green with the phase-1 pass count, B1–B8 green, import-linter green. Window closes when the old file is facade-only |
| **4b — Remaining grouping** | Coordinated follow-up windows | Follow §5.7; preserve layering, retain old-path wrappers and update the migration guide with each landed move | Current consumers and patches migrated; B1–B8 and structure/type/import checks green |
| **5 — Facade removal** | Per facade, after §6.1 evidence is complete | Delete eligible wrappers in a dedicated cleanup PR; handle the Parcel Perfect package separately; update guardrails and docs | No consumer on `dev` or maintained open branches; owner acknowledgements and green CI on the removal revision |

The rev. 1 plan split "extract into temporary modules" (phase 4) from "move into
sub-packages" (phase 5). That moves the same code twice and breaks the same imports and
patches twice. Rev. 2 does both in one window per package.

**Function-level cleanup (E) outside the package windows:** functions in files that are
not scheduled for a package move can be decomposed any time, under the phase-0 rule
"leave a touched file smaller". Functions inside a scheduled package wait for its window,
so nobody edits code that is about to move.

### Behaviour-preservation checks (phase 1)

Each check is a test or script committed **before** cleanup and run after every commit
in phases 2–5. Where an existing test already pins the behaviour, the check names it
rather than duplicating it — the phase-1 PR's first task is to confirm which exist.

| # | What must not change | How it is pinned |
|---|---|---|
| B1 | **API contract**: routes, methods, request/response schemas, status codes | Snapshot `app.openapi()` to a committed JSON; the test fails on any diff. Moves must produce an empty diff |
| B2 | **Authorization** per route | Snapshot of `(path, method) → dependency names` (driver / dispatcher / receiver-OTP / none), plus the existing integration 401/403 tests |
| B3 | **Canonical hashes** | Golden vectors: fixed inputs → expected SHA-256 for all 10 `compute_*` builders and `compute_trip_canonical_payload`. Any change to a hash is a tampering signal on already-anchored receipts |
| B4 | **Legacy verification** | Fixtures for each receipt generation `_reconstruct_phase_event_payload` (`verification_service.py:251`) dispatches on: pre-phase handshake shape, departure/confirmation v1, v2 with artifact roles. Each must verify `MATCH` against its stored hash. Extend `test_phase_anchor_payload.py` / `test_every_phase_anchoring.py` where a generation is uncovered |
| B5 | **Transaction boundaries, replay and concurrency** | Existing integration tests for: phase completion commits even when anchor dispatch fails (fail-open); replayed offline submission does not overwrite captured fields; duplicate `client_report_id` returns the original exception; concurrent claim/review locking. List the test names in the PR; add any that are missing |
| B6 | **Anchoring recovery and Celery** | Registered task names unchanged (`tasks.blockchain.anchor_phase_event` and the recovery beat task are explicit `name=` strings — assert the set). `recover_phase_anchor` recovers a PENDING row past `due_before`. Note: per-module loggers change logger *names*; check no log filter/alert keys on `app.orchestration.phase_service` |
| B7 | **No import cycles** | For every module under `app/`, `python -c "import <module>"` in a fresh interpreter (catches order-dependent cycles that a full-app import hides), plus import-linter |
| B8 | **No test patches through a facade** | A test (or CI grep) that fails if any `patch`/`monkeypatch.setattr` targets `app.orchestration.phase_service`, `trip_service` or `exception_service` once their windows open |

### Test patch inventory (alias-aware AST scan of `backend/tests/`)

| Target module | Patch / setattr sites | Files |
|---|---|---|
| `orchestration.phase_service` | **13** (incl. 2 that patch a dependency attribute via the module, e.g. `phase_service.scan_service.load_consignments_at_stop`) | 3 |
| `orchestration.exception_service` | 2 | 1 |
| `orchestration.trip_service` | 21 | 1 |
| `integrations.parcel_perfect` | 15 (6 patch `…parcel_perfect.settings.*` — retarget to `app.core.config.settings`) | 7 |

22 test files mention `phase_service` at all (two are support files rather than test
modules — not independently re-checked). Rev. 1's 8 / 22 / 37 undercounted multiline
patches and aliases.

**Rev. 4:** every site above was retargeted in its window. The later windows added more:
evidence 19, fleet 29, consignments 29 (plus 2 string-constant targets the scanner could not see
then), `app/dev` 7. B8 now freezes 30 facades (29 in `orchestration/` plus the `parcel_perfect` package) and
reports no patch through any of them.

### How to avoid breaking four branches

- **Do not pause the team.** One cleanup owner. For each package window, agree a
  checkpoint with whoever has open work in that package; freeze edits to *that package
  only* from the checkpoint until the window's move commits merge (aim: days, not a
  sprint). Everything else carries on.
- **Pure moves only** in move commits. Behaviour changes go in separate commits.
- **Zero functionality loss is an acceptance condition**, demonstrated by B1–B8 and the
  pass count after every move. No review — this one included — can guarantee it in advance.

### 6.1 Team migration and facade-removal tracking

**Decision, 2026-10-09:** keep wrappers now to ease migration; remove them deliberately after
the consuming branches have moved. The developer integrating the restructure coordinates this
table and names the owner of each removal PR. Branch owners own migration of their own work.
No acknowledgement, role acceptance or branch inspection is implied by adding a name below.

| Developer | Branches and revision checked | Migration acknowledgement / evidence | Status |
|---|---|---|---|
| Ciaran | `Ciaran`; record the integrated `dev` revision and any other maintained branch | Pending recorded reference scan and validation results for the migration revision | Unconfirmed |
| Tim | `Feat-ValueAddedDocumentation` at `8d732d8` (only maintained backend branch), integrating `dev` at `bb08597` | **Old paths:** reference scan of the branch's 39 changed `.py` files found 2 consumers, both `phase_service` imports in the seeds (`tests/integration/audit_pack_seed.py`, `scripts/seed_audit_pack_demo.py`), moved to `orchestration.phases.payloads`; `verification_service` import and the `hash_stored_evidence_file` patch target unchanged; no other patch targets on moved modules. **Pending edits:** none were in wrapped modules. **Integration fixes:** migration re-chained onto `ciaran_pp_manifest_trips` (one head) and RLS enabled on its 3 tables; seeds use journey-lock v2; endpoints no longer import `app.storage` (orchestration re-raises storage errors as `core.exceptions` domain errors); `build_audit_manifest` split into loaders plus section builders (old/new manifests compared identical across 24 scope/option combinations); 3 PLR0913 and the seed PLR0915 fixed; CI installs WeasyPrint's Pango/HarfBuzz libraries. **B1/B2:** additions only (15 audit-pack paths, 33 schemas, enum values `audit_pack`/`audit_pack_issued`, 17 auth entries); B3/B4/B6/B8 unchanged. **Checks (local PG17):** ruff, check_structure, lint-imports (20/20), mypy clean; pytest `not slow` 2506 passed, 4 skipped (`test_seed_fixtures` by design); B7 244 passed; dispatcher tsc, eslint (0 errors), vitest 1518, build green. **PR/commit:** integrated into `dev` by merging `0193ffd` into `Ciaran` (Ciaran's integration PR, which also drops the temporary `CLAUDE.md` handoff note) | Migrated; integrating |
| Chiko | `Chiko` (only maintained branch), fast-forwarded to `dev` `bb08597` on 2026-10-10; no branch-only commits; FP-149 parcel search uncommitted on top | Old paths migrated: `tests/unit/test_parcel_trace_projection.py` `phase_plan` → `phases.plan`, `phase_service._is_resolved` → `phases.state`; reference search of every old path in the guide finds no other FP-149 consumer. Pending edits to moved modules: none; FP-149's new read-only modules live in `orchestration/parcel_trace/` (`service`, `queries`, `projection`, `evidence`; empty `__init__`; no wrapper, no prior consumers). Patch targets: no module-path patches (one `patch.object` on the test session). Checks (`.venv312`, pydantic 2.14.0): ruff, `check_structure`, import-linter 20/20 and mypy (485 files) pass; pytest `not slow` 2384 passed, 4 skipped (intentional, `test_seed_fixtures.py:173,182`), 0 failed; B7 slow 237 passed; B1/B2 snapshots regenerated, additive only (2 `/api/v1/parcels/*` routes, 10 `Parcel*` schemas, 2 dispatcher auth entries). Dispatcher tsc, vitest (1493), eslint (0 errors) and build pass; driver-pwa tsc, vitest (859) and eslint (0 errors) pass. UI smoke against the integrated backend pending (needs a dispatcher sign-in). Wrappers still needed by FP-149: none. PR/commit: FP-149 merged into `dev` as PR #72 (`7b1342f`) | Migrated; merged; UI smoke pending |
| Tom | Owner to list maintained branches | Record migrated paths or explicit “no affected consumers”, PR/commit and checks | Unconfirmed |

**Review trigger:** revisit this table when the restructure lands on `dev`, at each affected
feature-branch merge, and before a PR touching a moved module is approved. Each branch owner follows
the [migration guide](2026-10-09-backend-structure-migration-guide.md) and records its sign-off here.
At each checkpoint identify which wrappers are now eligible; do not leave phase 5 as an unnamed
“later” task. An abandoned branch must be explicitly marked retired by its owner, not silently assumed
irrelevant. Completion is per wrapper, so unrelated open work need not hold up all cleanup.

Before deleting any candidate wrapper:

- [ ] Record the candidate old paths, removal-PR owner and relevant branch owners here.
- [ ] Every relevant owner confirms that the package moves are integrated and pending feature edits
      were moved into the implementation modules, not left inside a wrapper.
- [ ] Search `dev` and each relevant maintained branch for old imports, aliases, string-based patches,
      dynamic imports and script/task references. Record branch revisions and classify remaining hits.
- [ ] Migrate all executable consumers, including ordinary imports in tests; B8 only guards patch sites
      and is not proof that ordinary imports are gone.
- [ ] Remove eligible wrappers in a dedicated PR. For `integrations/parcel_perfect/__init__.py`, retain
      the package: retiring its compatibility exports must preserve fixture registration/order and
      direct-submodule imports. Do not delete the implementation directory.
- [ ] Update import-linter/B8/import-discovery checks and structure baselines for the removed paths.
      Keep or replace protection against reintroducing retired imports; do not merely disable checks
      to make the deletion pass.
- [ ] Run the migration-guide checks and affected UI smoke tests; attach counts, skips and green CI
      for the actual removal revision. Update this audit and the guide's current-path inventory.
- [ ] Record the merged removal PR/commit and notify the affected developers through the team's
      normal channel. Documentation changes alone do not send that notification.

**Removal record:** none yet. For each retirement, append the old paths, branch acknowledgements,
reference-check revisions, validation evidence and removal PR/commit here.


### 6.2 Completion plan to submission (23 October 2026)

Every stage is owned by **Ciaran** unless the row names someone else. To take a stage, put your name
in its Owner cell in a PR, so everyone can see who has it. Each stage is its own PR; behaviour
changes and moves stay in separate commits.

| # | Stage | Owner | Depends on | Done when | Target |
|---|---|---|---|---|---|
| 1 | Merge this restructure into `dev` | Ciaran | — | PR green in CI, reviewed, merged; Tim told to integrate | Sat 10 Oct |
| 2 | Receiver selfie: retain capture and implement secure upload/storage (review F2/F5; handoff below) | Tim | 3a–7 merged | `SELFIE_ONLY` is assigned only after a photo is stored and linked through `selfie_artifact_id`; skip or failed upload retains `TYPED_ONLY`. Decision recorded 12 Oct: keep capture, selfie travels in the confirm request (handoff below); Tim starts after the restructure merges; not yet implemented | Tim to set, before stage 8 |
| 3a | Thin `endpoints/handover.py` | Ciaran | 1 | Routes validate, call `orchestration/handover/`, return; no DB calls in the route module; B1 snapshot unchanged. **Done 12 Oct**: 466 lines, DB work in `handover/service.py`, transactions stay in the route (§5 deviations); 19 characterisation tests added first; 2,820 passed, 4 skipped | Wed 14 Oct |
| 3b | `resource_service` → `trips/` (list, history, detail reads) | Ciaran | 1 | Wrapper kept; patches retargeted; guardrails green. **Done 12 Oct**: `trips/detail.py` and `trips/listing.py`, 22 contracts, 2,822 passed, 4 skipped | Thu 15 Oct |
| 4 | `review_identity`, `review_policy` → `exceptions/`; analytics pair → `orchestration/analytics/` | Ciaran | 1 | Wrappers kept; guardrails green. **Done 12 Oct**: 25 contracts, 2,827 passed, 4 skipped | Thu 15 Oct |
| — | Tim integrates `dev` into his branch and merges | **Tim** | 1 | His branch green on the integrated revision; §6.1 row filled in | Thu 15 Oct |
| 5 | Tim's modules → `orchestration/audit_packs/` | Ciaran | Tim's merge | Audit-pack tests green; `build_audit_manifest` assessed. **Done 12 Oct**: no wrappers; 21 contracts; 2,800 passed, 4 skipped; assessment in §5.7 | Fri 16 Oct |
| 6 | `verification_service`, `receipt_service` → `verification/`, with phase 3 D (`SubjectPolicy`, `record_and_anchor`) | Ciaran | 5 | B3/B4 legacy hashes unchanged; verification and subject-visibility tests green. **Dropped if not started by Fri 16 Oct**, recorded as remaining work. **6a done 12 Oct** (bug fix, separate commit): vehicle event verification false mismatch fixed through `fleet/canonical.py`; 2,846 passed, 4 skipped. **6b done 12 Oct** (pure move): `orchestration/verification/`, wrappers kept, 27 contracts, 2,853 passed, 4 skipped; **6c done 12 Oct** (phase 3 D, no behaviour change): two `SubjectType` registries and shared fleet anchoring; 27 contracts, 2,880 passed, 4 skipped | Sat 17 Oct |
| 7 | Remove wrappers that have no consumers (§6.1) | Ciaran | 1–6 | §6.1 checklist met for each removed wrapper; the rest stay, documented | Sun 18 Oct |
| — | **Structural freeze** from Mon 19 Oct | everyone | — | No moves, renames or refactors; only fixes found by testing | Mon 19 Oct |
| 8 | Integrated testing and demo | everyone | freeze | Every UI journey end to end (dispatcher, driver PWA, receiver, guard), failure and retry cases, deployed build, demo rehearsed | Thu 22 Oct |

If a stage slips, it moves to the remaining-work list. The freeze does not move. Wrappers left
in place at submission are an acceptable, documented state. A feature that claims evidence
it never stores is not.

### Stage 2 handoff — receiver selfie persistence (decisions: 12 October 2026)

**Status:** not implemented. **Owner: Tim**, starting from `dev` once the restructure (stages 3a–7)
is merged. Not urgent, but must land before stage 8 testing. Ciaran's decision: keep the selfie
capture and store it properly. If that cannot be done before stage 8, bring the scope decision
back to Ciaran; do not fall back silently.

**Confirmed source defect:** `record_consent_decision` in
`backend/app/orchestration/handover/receiver_verification.py` assigns `SELFIE_ONLY` as soon as a
consenting receiver says they have no document. No photo is required. In
`frontend/receiver/app/h/[token]/HandoverPageClient.tsx` the captured selfie is held in React state
only; the confirmation request never sends it. The record claims evidence it never stored.

**Design (decided 12 Oct; replaces the separate upload route planned earlier):** the selfie travels
in the confirm request, as the signature already does. Confirmation already provides the
capability token plus browser-binding cookie, single use (the redemption `UPDATE`), the public rate
limit and race safety, so a separate upload route would rebuild all of that and add an orphan-upload
path. Consequences:

- Consent with no document records `TYPED_ONLY`, `UNVERIFIED`, reason `NO_DOCUMENT`. The three
  existing tests that assert `selfie_only` after consent (`test_receiver_verification_endpoints.py`)
  test the defect and are updated in the fix commit.
- `HandoverConfirmRequest` gains an optional, size-bounded `selfie_jpeg_base64` (validated like
  `signature_png_base64`; bad input is a 422 before redemption, so the token is not burned).
- `orchestration/handover/service.py` `record_receiver_confirmation` stores the selfie after the
  signature, only when the verification row shows consent with no document: `create_receiver_artifact`
  with `ArtifactType.PHOTO` (string column, no migration; type checked from the bytes), link
  `selfie_artifact_id`, promote to `SELFIE_ONLY`; status stays `UNVERIFIED`, because a photograph does
  not verify identity. Inside a savepoint: a storage, image-type or database failure is logged, the
  tier stays `TYPED_ONLY` and the confirmation still succeeds. A selfie sent without that consent is
  not stored (POPIA). Commits and rollbacks stay in the route (§5 deviations).
- POPIA: private evidence storage only; never sent to Didit; neither the photo nor its hash is added
  to any anchored payload (that would be a new confirmation payload version and change B3).
- Receiver: send the captured image with the confirm request; skipping it still confirms; memory only,
  no browser storage. Consent wording distinguishes the photo FreightProof keeps from the images sent
  to the identity vendor, with a new consent version; historical consent hashes stay valid.
- Historical `SELFIE_ONLY` rows without an artifact are not rewritten; record them as a known data issue.

**Verification:** backend tests for no-document consent, a stored and linked selfie (trip ownership,
hash, null driver attribution), confirm without a selfie, a selfie without consent, oversized or
malformed input (422, token still usable), non-image bytes and a storage failure (confirmation
succeeds at `TYPED_ONLY`); existing confirm, cookie and race tests unchanged. B1 changes by the one
additive field only; B2/B3/B4 unchanged. Receiver vitest for send-when-captured and omit-when-skipped,
plus tsc, lint and build; a real-phone smoke test of both paths. Two commits: the `TYPED_ONLY` fix with
its tests, then selfie storage with the frontend. Do not read `.env`, run Alembic from a feature
branch, or use the shared database for destructive fixtures.

**Stages 3–6:** done 12 Oct, each committed separately; behaviour changes kept separate from moves.

---

## 7. Frontend

The marker's interface comment is about TypeScript (§1), so this half matters as much
as the backend.

- **`AuthPort`: done** (`221fb32`, `c4d98e7`). The interfaces live in
  `frontend/shared/lib/auth/port.ts` and are split by need (interface segregation):
  `AuthPort` (session, change events, sign-out), `PasswordAuthPort` for the dispatcher,
  `OtpAuthPort` for the driver. Driver profile loading is a separate `DriverProfileSource`,
  because loading a profile is not authentication. Adapters live in each app (Supabase,
  API, demo), because `frontend/shared/` has no third-party dependencies. Neither
  `AuthContext` calls Supabase or branches on demo mode any more. This is the most direct
  answer to "separation of concerns through interfaces".
- **Typed interfaces for the API client: deferred.** Do it together with consolidating the
  clients, after Tim's branch merges: it adds a third client (`client-portal/lib/api.ts`)
  and edits `dispatcher/lib/api/client.ts`.
- **Mocks in production code:** 8 non-test importers (7 excluding the dispatcher
  preview fixture), mostly in `driver-pwa` (`TripContext`, `AuthContext`, trip pages,
  `ProfilePanel`, `precinct-name`).
- **Duplication:** `dispatcher/lib/api/client.ts` (336) vs `driver-pwa/lib/api/client.ts`
  (223); two near-identical `useIdleTimeout.ts` (89 / 107). Move the shared transport and
  idle lifecycle into `frontend/shared/` behind typed interfaces.
- Largest non-test files are modest: `PhaseStepPageClient.tsx` (730),
  `LocationComparisonMap.tsx` (659), `TripContext.tsx` (495); `AllControls.tsx` (930) is dev-only.
- Add ESLint `max-lines` and `complexity` with the same ratchet as phase 0.
- The marker also named inconsistent naming (their example: "botService"). Worth a
  naming pass on the TS services when `AuthPort` lands.

---

## 8. Decisions needed from the team

1. **Adopt §5's layout and package rules** before anyone starts — it is shared ground.
2. **Cleanup owner** for phase 4, and the package-window order.
3. ~~New dev dependency: `import-linter`~~. **Settled**: added in PR #68.
4. ~~**Dev tooling:** move `dev_*` endpoints, services and `schemas/dev.py` into `app/dev/`?~~
   **Settled**: moved in `a2a8847`; the last 5 endpoint layer-skip ignores are gone.
5. **Dead tables:** the schemas are gone (phase 2 J). Drop the tables `MerkleBatch`,
   `TripTemplate`, `SlaConfig` too? That needs an Alembic migration and coordination.
   **`DriverSubstitution` is no longer a candidate:** Tim's audit-pack builder reads the model.
6. **Merkle leaf validation rule.** `MerkleBatchLeafCreate.validate_source_type`
   (checkpoint / exception / artifact) exists only on that otherwise-unused schema, so J kept
   it. If a write path for Merkle leaves is ever built, the rule must move with it.
7. **18 unused CRUD schemas for live tables** (`Organization*`, `User{Create,Update}`,
   `Vehicle{Create,Update}`, `DriverUpdate`, `Checkpoint{Create,Update}`, `TripExceptionCreate`,
   `EvidenceArtifact{Create,Update}`, `LocationPingRead`, `BlockchainReceipt{Base,Create,Update}`).
   Kept on purpose: they read as the shapes for future endpoints. Delete only if the team agrees.
8. **`CLAUDE.md` drift** (`crypto/` as Ed25519/PyNaCl; "Receiver = one-time OTP"; the
   sprint-ownership placeholder) needs the four-reviewer PR.
9. **Tim's merge date.** The API-client consolidation waits on it (phase 3 D landed in stage 6c). When he
   integrates `dev`, review B1/B2 differences against his intentional API/auth changes; regenerate
   snapshots (`UPDATE_SNAPSHOTS=1`) only after those changes are accepted, not to mask a move
   regression. The existing `build_audit_manifest` split (358 lines at review) remains his follow-up;
   review and update B6 if his feature intentionally adds Celery tasks. Record migration evidence in §6.1.

---

## 9. Verification basis

- AST scan of the **159** modules in `backend/app/`: function spans (all functions,
  including methods and nested), top-level symbol inventories with intra-module
  dependencies for `phase_service`, `trip_service` and `exception_service`,
  comment share, import graph, layer violations, `db.*()` / `select()` call counts.
- Alias-aware AST scan of `patch` / `patch.object` / `monkeypatch.setattr` targets in
  `backend/tests/`.
- `grep` for V1–V3 fingerprints, mock imports, dead-model references, `supabase.auth`
  calls, CI lint steps, explicit Celery task names.
- **Not run:** the test suite, any frontend build, Alembic, any refactor.

---

## 10. Validation of the 6 Oct review of rev. 1

The review's claims were re-checked independently before being applied.

| Review claim | My check | Result |
|---|---|---|
| Mock importers are 8 (7 excl. fixtures), not 10 | Import-path scan of non-test `.ts/.tsx` | **Agree** — 8 files, one is `__fixtures__/preview.ts` |
| `locations.py` `DriverSubstitution` is a comment | `grep` | **Agree** — line 29 is a comment |
| Seven `advance_*`, not six | AST + `_WRAPPER_BY_PHASE_TYPE` | **Agree** — arrival was missed |
| Gate does DB loading; single `anchoring.py` keeps the cycle | Read `_gate_and_load`, `_dispatch_anchor`, `tasks/blockchain.py:51,101` | **Agree**. Also `_reject_if_*` / `_scheduled_departure` read the DB |
| Inline DB ops 18 / 13 / 3 `db.*()`; 7 / 10 / 3 `select()` | AST call count | **Agree** exactly |
| Patch counts 13 / 22 / 38 (2 + 21 + 15) | Alias-aware AST scan | **Agree** exactly. Note: a further 12 patches target `app.tasks.parcel_perfect`, which is not moving |
| Five missed dev-endpoint integration imports | `grep` | **Agree** — 1 + 3 + 1 |
| 769 / 63 / 25 over 159 modules | AST | **Agree** |
| No ruff / import-linter config; CI runs bare `ruff check .` | File inventory, `ci.yml:90-96` | **Agree** |
| `AuthPort` omitted; marksheet interface comment is about TypeScript | 2 Sept audit row 7; marksheet text; `AuthContext.tsx` | **Agree** — both added (§3, §7) |
| `_finish_phase` belongs in `completion.py` | Dependency inventory | **Agree** — all 7 `advance_*` call it; `complete_phase` imports all 7 |
| Facade preserves imports, not monkeypatching | Python name resolution; e.g. `test_arrival_timestamp.py:31-50` patches `_gate_and_load`, `enqueue_event`, `get_trip_detail` on `phase_service` | **Agree** — 13 sites need retargeting |
| Ruff `C901`/`PLR0915`/`PLR0913` do not measure length | ruff rule semantics | **Agree** — AST length check added |
| Proposed `phases/` layout | Full symbol inventory | **Agree, with four refinements:** (1) `loading.py` → `loaders.py`, to avoid clashing with the LOADING phase; (2) existing `phase_gate.py` moves as `blocking.py` and **must stay separate** from `gate.py`, or `resource_service ↔ gate` becomes a cycle; (3) the review's list had no home for `_record_driver_position`, seal helpers or the activation scheduling rules — added `driver_position.py`, `seals.py`, `scheduling.py`; (4) sub-package `__init__.py` files must stay empty — the review did not say so, and re-exporting there recreates cycles |
| Priority scores are judgement | — | **Agree** — stated in §2 |
| Sept 580/4 baseline is unverifiable | Not run | **Agree** — phase 1 records a fresh one |
| "22 includes two support files" | Counted 22 files mentioning `phase_service` | **Not independently checked** which two are support files |
