# FreightProof SA submission-readiness and structure audit

**Reviewed:** 19 October 2026. **Branch:** `Ciaran`. **HEAD:** `d07334f2`. **Outcome:** the backend restructure largely holds; coding principles are not applied consistently enough for submission sign-off.

This is a dated audit snapshot, not a current release sign-off. Recheck findings against the current branch before acting. The audit made no application changes; this report was subsequently archived in `docs/reviews/` for follow-up. No repository source files were modified during the audit. The existing untracked files were left alone. The committed Graphify report and graph were used first to locate the earlier restructuring decisions, then findings were checked against current source. The graph is dated 15 October and predates the current driver-substitution work. Earlier audits are historical evidence, not today's defect list.

The scope combines an AST inventory of all 276 backend modules, resolved TypeScript import reachability, the existing automated checks, and targeted manual review. It is not a line-by-line review of every function. CodeRabbit CLI was unavailable; this report uses direct source review and the project's checks.

## Verdict and what to preserve

**Do not repeat the big restructure.** Keep the layer-first architecture with domain packages inside orchestration. The current tree has 13 orchestration packages and only `integrity.py` as a substantive flat module. The retired compatibility modules remain absent and the baseline tests that guard retired paths pass.

| Principle | Current assessment | Evidence / implication |
|---|---|---|
| Separation of layers | Mostly upheld | All 17 import-linter contracts pass across 276 files and 1,391 dependencies. Seven explicit layer-order exceptions remain. No direct `db.execute/scalar/scalars/add/flush` calls were found in production `api/v1` route bodies; those decorated routes are async. |
| Single responsibility | Partially upheld | The former giant flat services have been split. There are still 21 functions over 100 physical lines, and several new large files group distinct responsibilities. Size is a review signal, not automatic proof of poor design. |
| Open/closed | Strong examples, incomplete coverage | Phase completion uses a dispatch table. Subject visibility and reconstruction use registries with enum-coverage tests. Phase payload reconstruction still has a long version/type branch sequence. |
| Dependency inversion / interface segregation | Material improvement | `ParcelPerfectPort`, `ScanFeed`, the Hedera adapter, and frontend auth ports are real boundaries. New evidence publishing injects the task dependency; phase publishing still imports it upward under a documented waiver. |
| Substitutability | Defensible examples, limited verification here | Real/mock implementations share ports and existing tests. No live-provider compatibility was established by this audit. Do not add inheritance merely to demonstrate Liskov substitution. |
| DRY / one canonical representation | Good core examples; remaining drift | Fleet anchoring and verification share canonical builders. Transaction publication semantics have diverged between phase and evidence anchoring, producing the reproduced defect below. |
| Type safety | Good annotation coverage; failing enforcement | Only one backend function lacked a return annotation in the AST scan. No actual TypeScript `any` keywords were found in non-test authored source across the five frontend/shared trees. However, backend mypy reports 104 errors, including 10 in application code. |
| Clear, honest product scope | Needs cleanup | The SLA route is a stub; navigation still uses mock precinct coordinates; driver substitution has storage/access/lifecycle work but is not a complete user-facing feature. |

Preserve the existing hash builders, historical payload-version support, ledger-derived position, tenant checks, lock ordering, immutable custody history and explicit mock-provider boundaries. Keep rationale comments that explain these invariants. Functional services with explicit ports and typed records are a valid design; a wholesale conversion to classes would add risk without solving the issues found here.

## Fix before submission

### 1. Phase anchors can publish on a savepoint release — P1, reproduced

**Source:** [phase dispatch](<../../backend/app/orchestration/phases/anchor_dispatch.py#L71>), contrasted with [evidence dispatch](<../../backend/app/orchestration/evidence_anchors/dispatch.py#L45>).

`_dispatch_anchor()` registers a one-shot `after_commit` callback without distinguishing an inner savepoint release from the outer transaction commit. SQLAlchemy emits `after_commit` for both. The newer evidence dispatch code tracks transaction ownership and correctly distinguishes them.

An isolated reproduction used real SQLAlchemy transaction callbacks and mocked broker functions. Both publishers were registered in the outer transaction, a later savepoint was released, then the outer transaction was rolled back:

```text
After releasing savepoint: outer transaction active = True
Phase anchor published before outer commit = 1
Evidence anchor published before outer commit = 0
After outer rollback: phase publishes = 1 evidence publishes = 0
```

This is relevant to the real call sequence: departure dispatches before `_finish_phase()`, while `_finish_phase()` can record location findings through `begin_nested()`. The callback can therefore fire before the write it is supposed to publish becomes durable. The worker does have row locking and hash checks; this audit proves premature publication, not that a false Hedera receipt was produced. The immediate risks are work against uncommitted/reverted state, invalid-task failures and misleading retry debt.

**Required change:** give phase publication the same outer-transaction and rollback guarantees as evidence publication. Keep phase payload and worker validation behavior intact. Cover ordinary commit, outer rollback, successful nested release, nested rollback, successive savepoints and duplicate registration using actual transaction callbacks; also exercise the phase-completion/location-finding path with isolated PostgreSQL.

The reproduction output is preserved above. The temporary diagnostic script and logs are not part of this archived report.

### 2. Backend submission gates currently fail — P1

These are current-checkout results, not inherited claims from the October audit.

- **Ruff:** one error, `PLR0915`: `_reconstruct_phase_event_payload()` has 57 statements, against a maximum of 50, at [phase_payloads.py:127](<../../backend/app/orchestration/verification/phase_payloads.py#L127>).
- **Structure guard:** nine violations. A newly oversized function, six growing oversized functions and two growing tracked files.
- **Mypy:** 104 errors in 11 files. Ten are in application code; the remaining 94 are in tests.

Structure violations:

| Location | Recorded → current physical lines |
|---|---:|
| `evidence/checkpoints.py::log_checkpoint` | new over-limit function: 107 |
| `exceptions/creation.py::raise_exception` | 168 → 173 |
| `phases/advance_arrival.py::advance_arrival` | 151 → 157 |
| `phases/advance_departure.py::advance_departure` | 118 → 123 |
| `phases/advance_loading.py::advance_loading` | 112 → 125 |
| `trips/listing.py::list_trips` | 106 → 132 |
| `verification/phase_payloads.py::_reconstruct_phase_event_payload` | 177 → 192 |
| `api/v1/endpoints/handover.py` | 466 → 486 |
| `schemas/trips.py` | 425 → 437 |

Application type-error clusters:

- [substitutions/access.py:235](<../../backend/app/orchestration/substitutions/access.py#L235>): nullable lookup assigned to a variable previously inferred as non-null.
- [trips/availability.py:297](<../../backend/app/orchestration/trips/availability.py#L297>): the loop reuses the `window` parameter name for a tuple, producing incompatible assignment/indexing errors. Rename the local tuple and preserve the `TimeWindow` contract.
- [substitutions/service.py:524](<../../backend/app/orchestration/substitutions/service.py#L524>) and the completion path around line 579: `Driver | None` is passed to operations that require a driver. Establish and encode the required lookup invariant rather than adding blanket casts.

Seventy-six of the errors are in `test_driver_substitution_service.py`; the remaining test errors include nullable lookups, typed SQL result conversion and schema introspection. Fix those too: CI runs `mypy .`, so test errors block the same gate.

**Do not make this green by increasing the structure baseline or broadening per-file ignores.** Review and extract coherent responsibilities from the growing functions. Some schema/route file growth may be legitimate and require a reviewed budget adjustment, but it must be explained. Tighten the baseline where functions have already shrunk.

### 3. Finish or explicitly defer driver substitution — P1 release decision

[Lifecycle source](<../../backend/app/orchestration/substitutions/service.py#L1>) explicitly states that endpoints are stage C6 and there is deliberately no route yet. Static application imports likewise find no caller of `substitutions.service`. This is unfinished feature delivery, not an obsolete module to delete.

The current code includes custody models, access/availability changes and lifecycle services. The [implementation plan](<../../docs/superpowers/plans/2026-10-18-driver-substitution.md#L180>) still requires capture and late evidence, anchoring and verification, HTTP reads/notices, dispatcher/reporting integration, the compatible driver client, and combined acceptance evidence. Some checklist status is stale relative to existing source, so use code and recorded test evidence together.

A concrete downstream gap already exists: [audit-pack crew loading](<../../backend/app/orchestration/audit_packs/builder.py#L406>) orders completed substitutions by `substitution_at`, while the new authoritative custody chain uses `sequence_number`. The audit/export path must follow the same ordering before this feature is released. Reporting also needs the new actor/identity/custody facts, not just the legacy substitution record.

**Submission action:** make the feature's release status explicit and keep new arrangements disabled until the remaining integration is proven. If deferred, preserve current-driver resolution, permissions and recorded chain reads; disabling screens or reverting queries to the original driver is insufficient once custody amendments exist. No completed evidence or migrations should be removed as cleanup.

### 4. Add client-portal CI — P2, high value before submission

The [workflow](<../../.github/workflows/ci.yml#L312>) covers backend, dispatcher, driver PWA and receiver, but has no client-portal job. The portal now implements external audit-pack viewing and verification; it is no longer a placeholder. It locally passes lint, type checking and 57 tests.

Add the same install/lint/type/test/build checks for `frontend/client-portal`, including the existing canonical verification vectors. This closes a real coverage gap for a submission-facing surface.

### 5. Restore a reproducible driver-app install — P2 environment blocker

The local install lacks `@capacitor-community/image-to-text`, `@capgo/capacitor-document-scanner`, and `pdf-lib`. All three are declared in both `package.json` and `package-lock.json`; no dependency edit is indicated by this evidence.

Consequences here: type checking reports six diagnostics and seven test files cannot load. The other 139 test files pass, containing 1,410 tests. The loading failures all trace to those missing packages.

Recreate dependencies from the committed lockfile, then run type checking, tests, production/static-export build and the required native-device checks. Treat any remaining failure after that as a separate code defect. Do not declare the driver app broken solely from this incomplete local installation, or declare it submission-ready from the tests that happened to load.

## Complete or remove misleading leftovers

### SLA report route

[useSLAMetrics](<../../frontend/dispatcher/lib/hooks/useSLAMetrics.ts#L14>) always returns `null`. The [SLA page](<../../frontend/dispatcher/app/(app)/sla/page.tsx#L24>) nevertheless renders operational-looking reports, labels missing implementation as “No trips in this period,” includes development placeholder copy, and has an Export PDF button without an action.

**Recommendation:** remove or make the route explicitly unavailable for the submission unless a real SLA implementation is in the agreed scope. The existing analytics screens already have working data paths; do not build a second analytics feature merely to retain this placeholder. If retained, distinguish unimplemented, loading, failed and genuinely empty results.

### Mock-backed driver places and navigation

[directionsUrl](<../../frontend/driver-pwa/lib/utils/directions.ts#L13>) always obtains destination coordinates from `mockPrecincts`, and is used by the [live in-transit page](<../../frontend/driver-pwa/app/(app)/trip/in-transit/InTransitPageClient.tsx#L353>). For a real precinct that is absent from fixtures, the navigation control disappears. `precinct-name.ts` also uses fixture records as a live fallback, even though trip-list responses now provide server-resolved names.

**Recommendation:** use real stop/place data for live behavior; keep fixture lookup behind an explicit demo adapter. This is a data-source problem, not a reason to delete demo mode. The static mock-only `/trips/[id]` route is deliberate and must not be mistaken for the real `/trips/detail?id=...` route.

### Backend removal candidates

Reference checks found these application-unused items:

- `core/rate_limit.py::reset_client`: no callers, including tests; its docstring still says “Tests only.” A small, low-risk deletion.
- `BlockchainReceiptCreate`, `BlockchainReceiptUpdate`, `MerkleBatchLeafBase`, `MerkleBatchLeafCreate`: definitions/barrel exports, with leaf-schema validators tested but no application consumer. Review removal of the schemas and obsolete tests/barrel entries separately from database models.
- `MerkleBatch` / `MerkleBatchLeaf` and `SlaConfig`: registered models without current application readers/writers. Resolve their place in the submitted scope, but do not drop tables merely because the Python symbols have no callers.
- `TripTemplate`: no model-level service consumer, but `template_id` is still accepted, persisted and backed by an FK. This is a partially exposed feature seam, not a safe independent table deletion. Either explain/retain the future schema or remove its exposed API/UI seam through a coordinated change.

The old September suggestion to delete `DriverSubstitution` is now wrong: it is used by custody/access/availability, lifecycle and audit code. `TrailerGpsSnapshot` is also live. Keep both. Keep historical canonical payload versions and compatibility fields needed to replay queued evidence.

### Frontend removal candidates

A TypeScript-resolved import graph from App Router entrypoints found **23 application-unreachable candidates** after excluding framework/configuration entries, deliberate status re-exports and test helpers. Targeted searches checked the main candidates; test-only references are listed separately. These are removal candidates, not permission to delete teammates' planned work.

| Area | No application callers |
|---|---|
| Dispatcher hooks | `useVerify`, `useBlockchainReceipts`, `useElementWidth`, `usePpCapabilities` |
| Dispatcher domain components | `EvidencePacket`, `ExceptionBanner`, `PhaseAnchorSection`, `PhaseChain`, `ManifestPanel` |
| Dispatcher UI components | `Drawer`, `StatCard`, `StepRail` |
| Dispatcher test-only components | `LocationEvidenceSummary`, `TimestampWithIcon` |
| Driver unused components | `EvidenceReview`, `Card`, `IconButton`, `Skeleton` |
| Driver test-only code | `api/geocode`, `utils/trip-status-chip`, `AnchorProgress`, `SignaturePad`, `Chip` (referenced by the unreachable status utility) |

`useElementWidth` also has a stale mock reference in a trip-page test. Remove obsolete tests/mock declarations alongside their dead implementation. `VerifyButton` already owns the live verification behavior; wiring the unused hook back in would create unnecessary competing behavior.

The temporary raw candidate inventory also contained false positives such as `capacitor.config.ts`, test factories, fake IndexedDB and status re-exports; those are excluded from the 23 candidates listed above. The durable candidate list is the table in this report. Framework route files are roots even when the sidebar does not link them.

## Targeted restructuring worth doing

Choose responsibility boundaries, not arbitrary line targets. Finish correctness and release scope first.

| Target | Current size | Useful boundary |
|---|---:|---|
| `trips/creation.py::persist_trip` | 255-line function | Separate persistence of stops/trailers/cargo/phase plan from journey commitment and response assembly; preserve one transaction and crew/consignment locks. |
| `verification/phase_payloads.py::_reconstruct_phase_event_payload` | 192-line function | Version/type-specific reconstructors behind a dispatcher; keep missing-evidence and unsupported-version outcomes and historical hashes identical. |
| `audit_packs/builder.py` | 890-line file | Loaders/query context, record projections, and final manifest assembly. It currently contains all three; individual functions below 100 lines do not make the whole module single-purpose. |
| `handover/receiver_verification.py` | 677-line file | Pure identity/verdict rules, verification lifecycle/quota/consent, and webhook ingestion. Keep capability/privacy/rate-limit behavior in place. |
| `substitutions/service.py` | 673-line file | Idempotency operations and canonical correction commitments can be leaves under lifecycle orchestration. Do this alongside remaining feature work, not as a standalone broad rewrite immediately before submission. |
| Driver `PhaseStepPageClient.tsx` | 743-line file | Route/availability gate, the shared phase controller, and per-phase adapters. It already has a reusable controller: extract that existing boundary rather than inventing a new framework. |
| Driver `useOfflineQueue.ts` | 659-line file | Queue persistence/migration, synchronization policy/store and the React subscription facade. Preserve retention, retry/idempotency and actor/custody semantics; do not simplify away offline compatibility. |

The original dispatcher trip wizard is already substantially improved: its page is now 506 lines rather than the historical 1,113, with extracted components. Do not report the old monolith as still present. Its remaining size is less urgent than the failing backend gates and transaction bug.

## Make the principles enforceable on new work

Passing import checks means the existing contracts held, not that every new submodule acquired an internal tier rule.

- Add internal package contracts for `orchestration/substitutions` and `orchestration/evidence_anchors`.
- Extend the named module coverage for new `trips/route.py`, `verification/evidence_payloads.py` and `audit_packs/anchor_tiers.py`; the current tier lists do not name them.
- Place `app/reporting` explicitly in the layer policy. It is outside the named layer list today; its current imports look downward, but that direction is not enforced by the contract.
- Test new contracts by showing that a wrong-direction import fails. Keep the existing 17 contracts and retired-module guard tests.
- File-size tracking currently names only four files. That permits a new large module such as the 890-line audit builder while every function stays under the limit. Add reviewed file/responsibility budgets for the important new modules.
- Ruff's complexity exceptions apply per file. A new complex function added to an exempt file can evade the intended complexity policy. Prefer scoped exceptions or a function-level diagnostic inventory; do not expand the exceptions casually.
- Frontend lint does not impose a structure/complexity policy. Introduce a reviewed baseline for the important authored screens/controllers if the team wants the same ongoing protection there; do not enforce a new blanket limit against all historical code at once.

The seven current layer-order ignores are explicit debt: two core-to-enum edges, four schema-to-analytics edges and the phase-dispatch-to-task edge. They are not seven new regressions. Move genuinely shared pure vocabulary/calculations down only where the benefit justifies the change. The injected evidence publisher provides a useful local example for eventually retiring the task-layer waiver.

## Documentation and submission cleanup

- [README:149](<../../README.md#L149>) says the client portal has only a README and is not built. That is false today: it has routes, components, verification code and 57 passing tests. Add it to the project tree, setup, deployment and demonstrated-capabilities list.
- [CLAUDE.md:124](<../../CLAUDE.md#L124>) describes the older seven-phase single-leg sequence without arrival. The current README/model includes arrival. Update the canonical explanation, examples and phase counts consistently.
- [CLAUDE.md:74](<../../CLAUDE.md#L74>) still says CI never runs Alembic, while CI now checks one head and applies the migration chain to an isolated database. Keep the warning about autogenerate drift; correct the CI claim.
- The entry-point instructions mention only two frontend surfaces; there are now four. The sprint-ownership link is still a placeholder. Resolve both for a clean submission handoff. Changes to `CLAUDE.md` need the project's four-reviewer process.
- Update current-status summaries and feature checklists. Keep old audits/plans as dated history rather than silently rewriting historical measurements.
- Remove stale retired `*_service` path references when editing relevant docstrings, with the intended OpenAPI/snapshot review where text is public contract.
- Dependency scans and the secret-scan step are `continue-on-error`. Their presence alone does not establish a clean release. Inspect actual CI results and resolve/document actionable findings before submission. No current vulnerability count was obtained in this audit and none is implied here.
- Separate DB-backed tests currently living under `unit/` over time, or clearly document the fixture distinction; a directory named `unit` is not proof that all tests execute without PostgreSQL.

## Verification record

| Check | Result |
|---|---|
| Backend import-linter | PASS: 17 contracts; 276 files, 1,391 dependencies; seven layer-order ignores remain |
| Backend ruff | FAIL: one `PLR0915` diagnostic |
| Backend structure guard | FAIL: nine violations |
| Backend mypy | FAIL: 104 errors in 11 files; 10 app / 94 test errors |
| Backend unit + baseline, excluding slow, initial isolated run | 1,629 passed, 317 skipped, 277 deselected; nine warnings |
| Backend complete unit suite, local test services accessible | PASS: 1,874 passed, four skipped, nine warnings in 36.18s; Redis teardown exceptions remain |
| Dispatcher lint / types | PASS / PASS |
| Dispatcher tests | PASS: 202 files, 2,900 tests |
| Driver lint | PASS with one test-only image warning |
| Driver types | FAIL: six diagnostics associated with three locally missing packages and dependent inference |
| Driver tests | 139 files / 1,410 tests passed; seven files failed to load due to those packages |
| Receiver lint / types / tests | PASS / PASS / 18 tests passed |
| Client portal lint / types / tests | PASS / PASS / 57 tests passed |
| Receiver production build | PASS, using isolated source copy and placeholder configuration |
| Dispatcher / client portal production builds | BLOCKED: Google Fonts DNS/network unavailable; compilation stopped before build verification completed |
| Driver production/native build | Not run while local dependencies are incomplete |
| Migration chain, static AST inspection | 58 revisions, one head (`ciaran_checkpoint_actor`), no missing parent references |
| Full migration application / DB integration / live providers | Not verified in this audit |
| Transaction callback reproduction | FAIL in phase path; evidence path control behaves correctly |

The initial backend unit/baseline run used throwaway settings with repository dotenv loading disabled and no test database configured, intentionally skipping DB-dependent cases. The stop-hook follow-up ran the complete unit suite with dotenv loading still disabled, DATABASE_URL and TEST_DATABASE_URL pointing only to the dedicated local freightproof_test database on port 5433, and Redis database 15. It executed the DB-backed unit cases successfully. The full integration suite was not run. No live database, broker or Hedera calls were needed for the callback reproduction. The migration inspection did not execute migrations. Build copies excluded environment files and wrote outside the repository; no production build was deployed.

Warnings worth cleaning: the installed `python-jose` emits a `datetime.utcnow()` deprecation warning; three trip-service tests produce an unawaited AsyncMock warning in `phases/state.py`. These do not fail this run, but reduce the reliability of a clean test transcript. Review dependency compatibility before upgrading; this audit does not prescribe new versions.

## Stop-hook follow-up: distinguish sandbox failures from application failures

After the initial audit, the automatic stop hook reported 61 failures and 34 setup errors. Its `tests/unit` selection includes database-backed cases despite the hook comment saying no database is needed. It was triggered by the pre-existing untracked `backend/node_modules/` directory; there were no tracked backend edits.

A listed setup error was reproduced with explicitly configured local test services: the sandbox raised `PermissionError: [Errno 1] Operation not permitted` while connecting to PostgreSQL. With access to the dedicated test services and environment-file loading disabled, all 16 tests in `test_trip_service.py` passed, including the four named by the hook. This is evidence of an execution-permission problem for those failures; it does not establish that every original failure has the same cause. The complete unit-suite rerun then passed **1,874 tests, with four skipped and nine warnings**, in 36.18 seconds, with no application changes. The original red summary is therefore not a reproduced code regression under the controlled, service-accessible test configuration.

Redis still emits two `Event loop is closed` connection-destructor exceptions after the passing suite exits. This is a separate test/resource-lifecycle cleanup item: close cached asynchronous Redis clients on their owning event loop before that loop shuts down, and verify teardown. The passing test exit does not make this warning clean.

The hook's output should remain visible, but neither modifying application code nor suppressing the hook is justified merely to compensate for denied service access. Ensure the check has an isolated test database/Redis and appropriate local network access; distinguish authored backend changes from unrelated untracked dependency folders.

## Recommended execution order

1. Fix phase publication and its real transaction regression tests. Restore the existing lint/type/structure gates without broad suppression.
2. Agree the exact submitted feature scope. Finish driver-substitution integration as one coordinated feature or defer it safely; remove the misleading SLA surface if it is outside scope.
3. Restore the driver install, add portal CI and make live driver place/navigation data independent of mock fixtures.
4. Delete the small unused frontend/backend code in a focused change after checking teammate ownership. Treat table drops and the template API seam as separate schema decisions.
5. Split only the modules that need work for the fixes or continued feature development; extend contracts/budgets at those boundaries.
6. Correct documentation; run the full backend suite and migrations on isolated PostgreSQL/Redis, all four frontend builds/tests, and the supported mobile/export demonstration. Record exact limitations and scan results.

No estimated hours are assigned without the submission date and team allocation. The first three items have a clearer submission payoff than another broad structural reorganisation.

**TASK COMPLETE — analysis only.** Modified repository files: none. Migrations applied: none. Shared files changed: none. Git write operations: none. Submission readiness: **not signed off**, for the specific failures and unverified release paths above. This report is archived in `docs/reviews/`; essential evidence is included inline. Temporary diagnostic logs remain outside the repository.
