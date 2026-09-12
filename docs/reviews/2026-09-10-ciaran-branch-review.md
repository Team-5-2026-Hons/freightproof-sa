# Ciaran branch review and iteration 3 priorities

Reviewed 10 September 2026. Branch `Ciaran`, HEAD `59db276`. Read-only application review; no fixes applied.

## Assessment

The top-level architecture is appropriate for this project. Keep the modular FastAPI backend, separate dispatcher and driver applications, shared frontend contracts, and explicit integration adapters. There is no case here for microservices, a generic repository layer, or a wholesale folder reorganisation.

The branch improves the application substantially, particularly exception review, concurrency handling, real dispatcher data, pagination, and trip-detail composition. However, it is not ready for an unconditional “best practices followed / ready to merge” verdict: there are reproducible offline evidence-loss paths and the configured backend type check fails. Some problems are inherited rather than introduced by the latest work.

The code is generally understandable at the domain level, but not consistently the simplest expression of its behaviour. Large modules, duplicated request-state handling, verbose historical comments, and a few dependency cycles increase the effort needed to explain and modify it.

## Comparison and review limits

Fetched `origin` before finalising the comparisons. Local `main` was stale; local `dev` matched its remote. Use the remote comparisons below for review.

| Merge-base comparison | Changed files | Added lines | Deleted lines |
|---|---:|---:|---:|
| `origin/dev...HEAD` | 230 | 25,765 | 2,646 |
| `origin/main...HEAD` | 349 | 452,973 | 111,169 |

These are branch-introduced changes relative to each merge base, not measures of authorship. The main comparison includes work already integrated into dev. Graph output contributes 408,244 added lines to the main comparison; raw diff size exaggerates application complexity.

Read the repository instructions, existing graph report, graph query results, iteration plan, previous presentation evaluation, current known issues, and relevant source/tests. The graph is dated 2 September and predates much of this branch. Source was authoritative. CodeRabbit CLI was unavailable, so this is a direct review, not a CodeRabbit result.

Critical paths received deeper inspection than static assets and generated files: evidence submission/replay, phase transitions, corroboration, exception ownership/review, pagination, session caches, migrations, and verification. This is a broad branch review, not an exhaustive proof of every line or a penetration test. No live browser/phone rehearsal, production build, live partner API validation, migration upgrade/downgrade execution, or current Jira-board verification was performed. Missing features below mean missing from this branch, not necessarily missing from teammates' branches.

## Findings to fix

### 1. P1 — a blocked phase is silently discarded from the offline queue

Location: `frontend/driver-pwa/lib/hooks/useOfflineQueue.ts:380–395`; backend contract: `backend/app/api/v1/endpoints/phases.py:126–138` and `_gate_and_load` in `backend/app/orchestration/phase_service.py`.

The queue treats every 409 as proof that an earlier attempt succeeded. But the endpoint also returns 409 for unresolved earlier phases, incomplete scan gates, premature activation, and blocked activation. Successful phase replays return 200.

Reproduced using the actual TypeScript module transpiled into an isolated Node harness with mocked React/API/storage: enqueue a phase, have `submitPhase` reject with 409, and flush. Result: `queueLength=0`, `droppedCount=0`, stored queue `[]`.

This can erase an unloading submission while warehouse scans are still pending. The queue's per-trip stall protection only handles transient failures, so this branch bypasses it. The broad 4xx rule also deserves explicit handling for reauthentication: 401 should suspend delivery pending login, rather than delete evidence.

Recommendation: classify recoverable state conflicts explicitly, retain the entry and stall later phases for that trip. Remove only after a successful acknowledgement or a verified already-recorded result. Expose permanently rejected evidence for recovery rather than silently treating it as delivered.

Origin: inherited queue behaviour remains in a file substantially changed by this branch.

### 2. P1 — phase/checkpoint queueing can report success after storage fails

Location: `frontend/driver-pwa/lib/hooks/useOfflineQueue.ts:437` onward, especially the unchecked `saveQueue(q)` in phase/checkpoint/location enqueue functions; `frontend/driver-pwa/lib/submission/phase-submitter.ts:294–295`.

`saveQueue` now returns a boolean and exception enqueueing handles failure sensibly. Other entry types ignore it. The phase submitter unconditionally returns `kind: 'queued'` after calling `enqueuePhase`.

Reproduced with storage throwing a quota error: the hook reports one queued item, but storage contains zero keys. Flush reads from storage, so the item cannot be sent. Base64 phase photographs make this a realistic failure, not an exotic edge case.

Recommendation: use a persistence-result contract for every enqueue function and show an unsaved state when persistence fails. Subsequently move photo/blob evidence to IndexedDB or the native storage equivalent; keep an explicit durable acknowledgement. Browser storage remains fallible even with a larger store. [MDN storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria) and [Web Storage guidance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API) support this distinction.

Origin: existing weakness, only partially addressed by the new exception-specific handling.

### 3. P1 — the branch fails its configured backend type-check gate

`backend/.venv/bin/mypy .` reports **16 errors in three files**:

- `backend/tests/unit/test_schema_validators.py:641,660`: omitted required constructor argument `contact_method`.
- `backend/tests/unit/test_demo_waypoints.py`: optional coordinates passed as non-optional, fake precinct incompatible with the declared ORM type, and comparisons against optional distance values.
- `backend/tests/integration/test_dev_pulsit.py:69`: `.path` accessed on `BaseRoute` without narrowing.

CI runs exactly `mypy .` (`.github/workflows/ci.yml:94–96`). Passing pytest does not satisfy this gate. These files are added or changed relative to dev.

Recommendation: narrow optional values with assertions in tests, use a correctly typed geometry input or suitable fixture, narrow the route type, and make deliberately invalid Pydantic input tests use the validation entry point. Do not disable checking for entire test directories.

### 4. P2 — normal integration tests depend on real Hedera configuration

Example: `backend/tests/integration/test_create_trip_multistop.py:153` calls trip creation without the Hedera mock used later in that same file (`_mock_hedera`, line 242).

The isolated test returned 504 instead of 201 after the 15-second Hedera timeout. A wider run with explicit dummy Hedera credentials exposed the same missing isolation in driver, vehicle, trip, and resource-uniqueness tests. This makes normal test results dependent on local credentials/network and prevents a reliable clean-machine gate.

Recommendation: mock the external Hedera boundary by default for normal integration tests while retaining real receipt persistence. Put intentional external smoke tests behind a separate explicit marker/job. Preserve dedicated failure/timeout tests.

Origin: mostly inherited test infrastructure; `test_resource_uniqueness.py` is also new relative to main. This is a test-quality finding, not evidence that 30 production behaviours are broken.

### 5. P2 — persisted tracker evidence loses its mock/live provenance

Locations: `backend/app/integrations/pulsit.py:96,155`; `backend/app/orchestration/corroboration_service.py:361–362,471–472`; phase/checkpoint/snapshot models.

The adapter correctly distinguishes `PulsitFixSource.MOCK` from `LIVE`, but the persistence layer discards that field. Horse readings also lose their tracker observation timestamp and device identity; only trailer snapshots retain a device/time pair. After configuration changes, an old simulated position cannot be distinguished from a real reading from the stored row.

Recommendation: persist source and observation metadata with corroboration, and expose simulated evidence clearly. Keep the demo dataset separate in the meantime. This is especially relevant to iteration 3's claim of independent corroboration. The live adapter itself explicitly states that its API shape is assumed; credentials alone are not proof of compatibility.

### 6. P2 — “Awaiting Pulsit” promises work that is not scheduled

Location: `frontend/dispatcher/components/domain/PhaseLocationSection.tsx:57`.

NULL also means missing fix, unavailable service, old client without capture time, or a fix outside the allowed time window. A completed phase is idempotently returned on replay; there is no automatic corroboration backfill represented here. Showing “Awaiting” can imply an answer will arrive when it will remain unknown.

Recommendation: use “Not available at capture” for a completed record, with a stored reason when available. Reserve pending language for actual pending work. This display is inherited but becomes more consequential now that corroboration is implemented.

## Structure, reuse, and simplicity

### Keep these choices

- `api → orchestration → integrations/storage/crypto` remains a sensible separation of responsibilities. Async SQLAlchemy and Pydantic v2 are appropriate.
- Database uniqueness and row locks protect real races. Exception review preserves the first assessment and reports competing review attempts; tests use independent transactions where concurrency matters.
- Shared frontend types, phase metadata, formatting, and validation reduce drift across the two applications.
- Trip detail is now a small composition page (117 lines) backed by named components. `TripTimeline`, `TripDetailPanel`, `PhaseEvidence`, and pure derived facts are a clear improvement over the previous monolithic page.
- The new cache layer explicitly considers request ordering, access withdrawal, session changes, and bounded growth. Those behaviours have value and tests.
- Keep phase status, exception review status, and anchoring status separate. They answer different questions.

### Small, worthwhile refactors

1. **Extract exception policy from exception workflow.** `_initial_review_status` in `phase_service.py:98` uses a lazy import to work around a cycle with `exception_service.current_phase_event`. Put the pure severity-to-review-state rule in a small policy module shared by both. Do not solve a three-line policy with a new service hierarchy.
2. **Share pagination mechanics, not domain queries.** `useTripHistory.ts` and `useExceptionHistory.ts` duplicate cursor stacks, page navigation, request generations, clearing, loading, and stale-result handling. Extract that state machine while preserving their different live-refresh and filter policies. Backend date-window conversion is another small shared primitive; avoid a generic query builder.
3. **Remove the superseded trip header after checking consumers.** `app/(app)/trips/[id]/TripHeaderSummary.tsx` has no importer in the current TSX source; the page uses `components/trips/TripSummary.tsx`. Keeping both invites parallel fixes to the wrong component.
4. **Shorten comments without deleting the invariants.** Keep concise explanations of locks, replay, NULL semantics, and provenance. Move old task numbers, abandoned alternatives, and repeated bug narratives into design notes. Several functions take more effort to find through commentary than to understand once found.
5. **Split by responsibility after integration.** `phase_service.py` is 1,743 lines; `trip_service.py` 770; the new-trip page 1,113; the dev panel 881. Phase eligibility, evidence payload construction, and anchoring are natural boundaries. The trip wizard can have a draft hook and step components. Avoid a broad split immediately before the demo.
6. **Tighten endpoint boundaries opportunistically.** `dev_pulsit.py` directly loads ORM resources, stages integrations, and computes responses. `dev_triggers.py` is 506 lines. Move workflow into an orchestration module when those areas next change. The blockchain router also skips the documented orchestration boundary. These are maintainability concerns, not reasons for a rewrite.

### Structure that needs policy rather than more folders

The ORM groups related tables in modules rather than literally using one file per table, and some append-only tables lack `updated_at`. That differs from CLAUDE.md, but splitting cohesive models or adding mutable timestamps just to satisfy prose is not automatically better engineering. Align the written standard with intentional choices through the team's review process.

`resource_service.py` now mostly contains trip reads: a future `trip_queries.py` is a more descriptive name. `components/domain` and `components/trips` overlap; gradually give trip-specific components one home. Do not relocate every component this week.

Generated graph history and the tracked root `node_modules/.package-lock.json` add review noise relative to main. Keep generated graph maintenance with the designated maintainer and remove tracked dependency artifacts through a normal team-reviewed change. Treat dated plans as historical records: the old SOLID audit still calls trailer snapshots writerless and exceptions mocked, both false on this branch. Its deletion list must not be executed blindly.

### Verification gap: migrations

The migration graph has one head: `ciaran_trip_history_page`. Five migrations differ from dev, nine from main. That is structurally encouraging, not proof they deploy cleanly.

Tests create schema with `Base.metadata.create_all()` rather than running Alembic. Therefore the passing query tests do not exercise column renames, data backfills, downgrade behaviour, or migration-only indexes. Add a disposable migration smoke job that upgrades the dev schema with representative legacy rows, checks preservation, and exercises the intended downgrade/re-upgrade window. [Alembic's cookbook](https://alembic.sqlalchemy.org/en/latest/cookbook.html) treats building from model metadata as a separate path from applying migration history.

## Verification results

| Check | Result |
|---|---|
| Dispatcher Vitest | 453 passed, 41 files |
| Driver Vitest | 729 passed, 82 files |
| Both TypeScript checks | Passed |
| Dispatcher ESLint | 0 errors, 2 image warnings |
| Driver ESLint | 0 errors, 1 image warning in a test |
| Backend Ruff | Passed |
| Backend mypy | 16 errors, 3 files |
| First isolated failing multistop test | Failed: 504 Hedera timeout, expected 201 |
| Creation concurrency file separately | 4 passed |
| Remaining backend suite, explicit test settings, multistop file excluded | 1,208 passed, 30 failed, 4 skipped |
| Migration graph | One head; not applied during review |
| Diff whitespace | One extra blank line at EOF in ChainReceiptTag.tsx |

The broad backend run used the dedicated local `freightproof_test` database with mock PP/Pulsit/IDVS and dummy Hedera credentials. Failures reached unmocked Hedera SDK construction. Four skips are explicit seed-walk cases, not skipped database integration coverage. A preceding full-suite attempt was interrupted after repeated external-call timeouts. These results do not constitute a green full suite. The run also emitted python-jose `utcnow()` deprecation warnings and Redis event-loop cleanup warnings.

## What to finish before iteration 3

The plan names the week of 21 September; the user's nearer “next week” deadline is the planning constraint here. Jira is explicitly the ownership authority, but this review could not verify its current state. Owners below come from the written plan.

### First: reliability and an integrated candidate

Fix the two offline evidence-loss paths and the mypy errors. Make routine tests independent of live Hedera. Validate migrations on disposable data. Coordinate an integrated dev candidate with the other developers; do not spend the remaining week polishing an isolated branch while integration risk grows.

Rehearse one complete scenario: create trip → activate → load → seal/depart → arrival → unload → confirm, including a mismatch, dispatcher review, and an offline replay. Test on the actual presentation phone and deployed candidate. Include tracker unavailable/stale cases so the UI demonstrates uncertainty honestly.

### Feature priorities already committed in the plan

| Priority | Item | Branch evidence / action | Planned owner |
|---|---|---|---|
| Essential | FP-154 artifact hash anchoring | `create_artifact` uploads and persists a file hash, but does not anchor it. Trip verification explicitly excludes every photo/phase. Finish an end-to-end anchored-artifact proof before claiming photo integrity. | Chiko |
| Essential | FP-155 receiver-controlled confirmation | No receiver capability/confirmation endpoint or receiver scan flow found. Driver OTP is not this feature. Integrate the receiver phone flow, with trip/stop binding, expiry, replay handling, and clear limits. | Tim |
| Highest-value next feature for Ciaran | FP-149 parcel search/history | Current PP lookups and manifests are not a parcel evidence-history screen. Deliver barcode/reference → waybill → linked trip/phase/evidence. Keep scope at waybill/parcel; no new pallet model. FP-266 scanner is optional demo input on top of a working lookup. | Ciaran; scanner Tim |
| High | FP-153 / FP-156 minimal analytics | No analytics endpoint found; `useSLAMetrics` returns null. Prioritise a small real read model for delays and exception counts by route/type. Label missing data. | Thomas |
| High | FP-157 receipt search | Current receipt lookup requires subject type and UUID. Search by hash/transaction ID remains a distinct deliverable. | Chiko |
| High, small | FP-159 finish or withdraw SLA screen | `/sla` still shows fabricated “No trips in this period” empty states and an Export PDF button without a handler. Wire it to real results or remove it from the presentation path. | Chiko |
| Conditional | FP-158 route reports | No route-report adapter path found. Defer if the real API contract is unavailable; do not expand the speculative adapter just for a slide. | Tim |
| Stretch | FP-161 evidence packet export | Useful after evidence/source/receipt data is trustworthy. Avoid exporting a polished document that implies every included fact is chain-verified. | Thomas |

Do not claim that a rotating QR alone proves the receiver is the intended independent person: it is a capability transfer and can be shared or scanned by another device. Explain the property actually achieved. Similarly, the current automated geofence flag checks the tracker against the facility; it is not a complete phone-versus-truck agreement policy. Both coordinates can be displayed while the automated exception only fires when the tracker is outside. Make that boundary explicit in the demo or add a separately defined comparison rule.

### Presentation work is part of delivery

The previous evaluation explicitly asked for clearer diagrams, state modelling, branching/story-point explanation, and reliable phone mirroring. Finish FP-151/152/162–166 in parallel with feature integration:

- Show one readable architecture diagram and a separate trip-state diagram. Distinguish the phase workflow from `created → active → closed/cancelled` state transitions.
- Explain what is stored in the database, what is hashed, and what the chain verifies. A hash does not establish the truth of a driver's claim.
- Put current status and responded-to feedback early. State self-sponsored status and the role of industry input.
- Demonstrate the stop-short scenario, a visible alert, a recorded review, and receiver confirmation if integrated. Follow with parcel lookup or real analytics to show business value.
- Rehearse mirrored phone interaction and retain a short backup recording of the same build.

Defer FP-167's broad phase-service split, the step-event ledger, arrival custody redesign, dispatcher assignment/watch lists, generic CRUD abstractions, and wide dependency upgrades until after the presentation. Small reliability fixes and truthful UI states matter more than structural churn this week.

For Ciaran specifically: **reliability/CI fixes → team integration → FP-149 parcel lookup → demo rehearsal**. The existing trip-detail refactor is enough structural progress for this iteration.
