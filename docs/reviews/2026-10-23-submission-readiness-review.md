# Submission readiness review — 23 October 2026

## Verdict

**Do not sign off the submission as-is.** The application is considerably healthier than the older audits suggest: backend quality gates pass, all four frontends build, and the existing test suites have strong coverage. The remaining immediate work is security hardening, two small staged UI regressions, accurate submission documentation, and release evidence. A broad architectural rewrite would be the wrong priority.

For an academic demonstration using synthetic data and explicitly declared mocks, the core implementation is close. For an internet-facing deployment handling real evidence, the reproduced availability weaknesses and dependency findings require attention first. Passing tests do not close those gaps: the current suites do not assert the failing security cases reproduced below.

Scope: the 125 staged files, backend layering and critical request/transaction/security paths, dispatcher, driver PWA, receiver, client portal, shared types, CI, and current plans/status documents. This was source review plus local execution, not an audit of hosting settings or a physical-device acceptance session. No application source, existing documentation, migration, or staged content was changed. This report is the only repository file created by the review.

## Verification actually performed

Tests and builds ran in `/tmp/freightproof-review-20261023/source`, a copy excluding environment files. Existing frontend dependency directories were linked into that copy. Builds used non-secret placeholder configuration; no live application credentials were needed. Backend tests used disposable local PostgreSQL 17 databases and local Redis, never the shared Supabase database.

| Area | Result |
|---|---|
| Backend Ruff | PASS |
| Backend structure ratchet | PASS |
| Backend import-linter | PASS: 23 contracts |
| Backend mypy | PASS: 793 source files |
| Backend default suite, excluding slow imports | 4,867 passed, 4 skipped; 9 setup errors from the timeout fixture's database-name safety check |
| Those 9 timeout cases, separate private PG17 container with the required database name | PASS: 9 passed, 13 deselected |
| Backend fresh-interpreter import checks | PASS: 376 passed |
| Dispatcher | Types PASS; lint PASS; 263 test files / 3,484 tests PASS; production build PASS |
| Driver PWA | Types PASS; lint PASS with one test-only image warning; 185 files / 1,772 tests PASS; static production build PASS |
| Receiver | Types PASS; lint PASS; 11 files / 156 tests PASS; production build PASS |
| Client portal | Types PASS; lint PASS; 20 files / 286 tests PASS; production build PASS |
| Alembic graph | One head: `ciaran_drv_arrival_dwell` |
| New analytics view SQL | Executed by the passing analytics integration fixtures, including the new arrival-dwell test |
| Staged whitespace/error check | `git diff --cached --check` PASS |
| Limited authored-source secret-pattern scan | No matches for the selected private-key/access-token patterns; environment files, dependency libraries and Git history excluded |

The backend total is **4,876 passing non-slow cases across the full run and the scoped rerun**, plus 376 slow import checks. The nine initial errors were not application failures: `test_db_timeouts.py` explicitly refuses a database name other than `freightproof_test`, while the first run used a unique review database name. A new private container supplied the required name without touching the normal test database.

The first driver test run explicitly forced live mode and failed nine tests that assume demo mode. The normal test configuration passed all 1,772. Initial builds without font network access failed at Google Fonts; network-enabled retries passed. The first driver build also correctly rejected a localhost API placeholder; the successful retry used a non-local placeholder origin. These are configuration distinctions, not fixes to application code.

Backend output still contains `python-jose` deprecation warnings, several unawaited AsyncMock warnings, polygon serializer warnings, and Redis destructor exceptions after event-loop shutdown. These deserve cleanup but did not account for a failed application assertion in this run.

Raw logs and scratch reproductions are under `/tmp/freightproof-review-20261023/`. The two additional review probes described below intentionally fail against the staged UI and were created only in the temporary copy; they are separate from the passing existing suites. CodeRabbit CLI was not installed, so no CodeRabbit review was performed; its official installation source is [coderabbit.ai/cli](https://www.coderabbit.ai/cli). The conclusions here come from direct source review, local checks and explicit reproductions.

## Findings to fix before release

### R1 — P1 / High: unauthenticated multipart input can consume the API event loop and flood logs

**Attack story:** someone without an account can POST malformed form data to an upload endpoint and make the API parse and log it before authentication rejects the request.

- [`backend/requirements.txt:24`](../../backend/requirements.txt#L24) pins `python-multipart==0.0.9`.
- [`artifacts.py:40`](../../backend/app/api/v1/endpoints/artifacts.py#L40) declares a multipart upload. FastAPI parses that body before calling the endpoint and its driver authentication dependency. The endpoint's Content-Length check runs after parsing, so it does not protect this work.
- An in-process request to `POST /api/v1/artifacts`, without authentication, returned 403 but emitted **3,000 multipart warnings for 3,000 extra trailing bytes**. The corresponding normal body emitted none. No storage or database write was needed.
- The maintainer documents this exact CPU/log amplification in [GHSA-59g5-xgcq-4qw3](https://github.com/Kludex/python-multipart/security/advisories/GHSA-59g5-xgcq-4qw3).

**Fix:** upgrade the compatible FastAPI/Starlette/multipart dependency set, and enforce bounded request bodies before multipart parsing, including streamed/chunked requests. Keep the endpoint's file-size validation as a second control. Add an unauthenticated malformed-upload regression; merely checking that the final response is 403 misses the issue.

### R2 — P1 / High: unknown JWT key IDs trigger blocking network requests

**Attack story:** someone can send syntactically valid but untrusted JWT headers with unknown key IDs, forcing synchronous JWKS fetches that delay unrelated users on the same worker.

- [`auth/dependencies.py:88`](../../backend/app/auth/dependencies.py#L88) uses blocking `urllib.request.urlopen(..., timeout=10)`.
- [`dependencies.py:109`](../../backend/app/auth/dependencies.py#L109) refreshes on every unknown `kid`, before the signature is verified, without a negative cache or shared refresh gate.
- A controlled reproduction replaced the network fetch with an 80 ms delay. Two unknown-key requests delayed a 10 ms event-loop heartbeat to approximately **173 ms**. This proves the blocking behavior; it is not a measurement of the real identity provider's latency.

**Fix:** asynchronous bounded fetching, one concurrent refresh, refresh cooldown/negative caching, and controlled authentication failure on fetch errors. Test that repeated unknown keys do not cause one outbound fetch per request and do not block an independent request.

### R3 — P1 for a real driver release: production builds can silently select simulated authentication and evidence behavior

[`driver-pwa/lib/constants/env.ts:2`](../../frontend/driver-pwa/lib/constants/env.ts#L2) makes demo mode true unless `NEXT_PUBLIC_DEMO_MODE` is exactly `false`. [`lib/auth/defaults.ts`](../../frontend/driver-pwa/lib/auth/defaults.ts) then selects demo OTP/profile adapters; phase API paths also use this switch. The production guard in [`next.config.ts:15`](../../frontend/driver-pwa/next.config.ts#L15) validates the API URL but does not reject demo mode.

**Failure story:** a release builder omits one variable, builds successfully with a real API URL, and hands drivers an app whose apparent successful interactions can be simulations. This is not a bypass of the backend's JWT authorization; it is a misleading and potentially unusable client release.

**Fix:** make demo behavior opt-in, require explicit release mode, and assert that the submitted live build uses the real adapters. Keep a deliberately separate, visibly identified demo build if needed. Existing demo-dependent tests should set their intended mode explicitly. This is still-open work from WI-06 in the 21 October fix plan.

### R4 — P2 / Medium: a forged Bearer header resets public-route rate-limit buckets

**Attack story:** a caller can cycle invented Authorization headers to exceed the public handover/identity-verification budget from the same IP.

[`core/rate_limit.py:150`](../../backend/app/core/rate_limit.py#L150) hashes any supplied Bearer string without verifying it. That helper is also used on unauthenticated handover, webhook and audit-pack routes. The full-token hash fixed the older shared-prefix problem, but not this public-route bypass.

A reproduction with the same IP and two invented tokens obtained two different identity buckets. The IDVS-specific budget is 5 requests/minute; the global IP middleware still imposes 300/minute, so this does not remove every limit. Per-token/session/quota checks may impose additional bounds.

**Fix:** public budgets must use IP regardless of Authorization. Authenticated budgets should use a verified principal. Add public-route tests with changing bogus Bearer headers. Preserve the global IP cap.

### R5 — P2 / Medium: capability tokens and provider credentials can enter logs

**Attack story:** a person or downstream logging service with access to application logs can receive a usable capability URL or a Parcel Perfect credential when a request fails.

- [`main.py:214`](../../backend/app/main.py#L214) logs the concrete request path in the generic 500 handler; handover/audit-pack paths contain capability credentials.
- [`rate_limit.py:183`](../../backend/app/core/rate_limit.py#L183) does the same for global 429s, before a route template is available.
- [`integrations/parcel_perfect/client.py:103`](../../backend/app/integrations/parcel_perfect/client.py#L103) puts `token_id` in the provider request URL; [`endpoints/pp.py:57`](../../backend/app/api/v1/endpoints/pp.py#L57) logs HTTP errors whose text can include that URL. Other task exception logs should be checked together.

The database-unavailable handler already uses a route template; apply that discipline consistently. This is a source-traced failure path, not evidence that a real secret has already appeared in a deployed log. No real tokens were read during this review.

**Fix:** safe route labels/templates, sanitized provider error fields, and redaction tests. Check access-log configuration too; fixing one application logger is not enough to establish that URL credentials are absent everywhere.

### R6 — release dependency gate: advisory scans are not clean

| Surface | Locked versions / scan result |
|---|---|
| Dispatcher | Next 15.5.25, sharp 0.35.4; npm production audit: 1 critical, 3 high package entries |
| Receiver | Next 15.5.25, sharp 0.35.4; same counts |
| Client portal | Next 15.5.26, sharp 0.35.4; same counts |
| Driver | Next 15.5.28, sharp 0.35.5; 1 high, 5 moderate package entries |
| Installed backend development environment | pip-audit returned 112 advisory records across 15 packages |

The Python count includes development tools and duplicate/aliased records: **it is not 112 demonstrated application vulnerabilities**. Likewise, npm's critical label is a package advisory, not proof that this deployment permits remote code execution. Some findings need specific image/server-action/SSG behavior; the driver's static export changes reachability. The multipart issue in R1 is independently reachable and reproduced.

The Next maintainer's [image-optimization advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw) names patched Next 15.5.28 and sharp 0.35.5. Update and re-audit the three lagging lockfiles, then triage remaining advisories against actual runtime paths. Review backend pins together: independently forcing a new Starlette beneath an incompatible FastAPI range is not a valid fix. The pinned `python-jose` also accounts for many deprecation warnings, although its JWE/algorithm-confusion advisories are not automatically reachable through this app's ES256-only JWT path.

CI currently treats dependency scans as report-only. Resolve or explicitly disposition actionable runtime findings; a green CI badge does not establish this gate is clean.

## Smaller findings and staged regressions

| ID | Priority | Finding and evidence | Action |
|---|---|---|---|
| R7 | P3, staged | [`ResizableHeight.tsx:45`](../../frontend/dispatcher/components/ui/ResizableHeight.tsx#L45) removes listeners only on pointer-up/unmount. A cancelled drag leaves the pointer-move listener active. A scratch probe performed pointer-down → pointer-cancel → unrelated movement: height became 620 px instead of staying 320 px. | Stop on pointer-cancel; preferably track/capture the initiating pointer and handle loss of capture. |
| R8 | P3, staged | [`route-name.ts:12`](../../frontend/dispatcher/lib/trips/route-name.ts#L12), [`trip-display.ts:26`](../../frontend/driver-pwa/lib/utils/trip-display.ts#L26), and header/phase helpers now parse only ` · `. Historical server values such as `FedEx JHB — Linbro Park` no longer split; the probe returned the entire string as the short name. Tests changed fixtures to the new delimiter, concealing compatibility loss. | Accept both historical and current delimiters in a shared helper. Keep stored names unchanged. This affects presentation, not custody or integrity. |
| R9 | P3 | [`idvs_webhook.py:45`](../../backend/app/orchestration/handover/idvs_webhook.py#L45) compares Unicode strings with `hmac.compare_digest`. A non-ASCII signature raises TypeError instead of failing authentication. Reproduced with a dummy secret and signature. | Validate ASCII/hex or compare encoded bytes and return false for malformed input. |
| R10 | P2 for real devices | [`AndroidManifest.xml:5`](../../frontend/driver-pwa/android/app/src/main/AndroidManifest.xml#L5) enables Auto Backup, with no backup exclusion policy found. The app stores sessions and offline evidence in WebView storage. | Disable backup or explicitly exclude credentials/evidence; verify behavior on the supported Android versions before distributing real evidence. Actual device backup contents were not inspected. |
| R11 | P2 maintenance | [CI](../../.github/workflows/ci.yml) has dispatcher, driver and receiver jobs but no client-portal job. The portal's 286 local tests and passing build are therefore not continuously enforced. | Add equivalent install/types/lint/tests/build checks for the portal. |
| R12 | P3 / scope clarity | [`useSlaMetrics.ts`](../../frontend/dispatcher/lib/hooks/useSlaMetrics.ts) always returns null. The SLA route cannot demonstrate live metrics. It is not linked by the current sidebar. | Wire it to supported metrics only if submitted scope includes it; otherwise remove/defer the route and avoid claiming it is complete. |

Saved substitution photos are now cleared after successful server confirmation in `useSubstitutionCapture.ts`; the old audit's claim that every saved capture retains full photos is no longer current. Retained unsent evidence intentionally survives session changes. A documented retention/export/deletion policy is still needed before real-device use; do not solve it by deleting unsent evidence on sign-out.

## Do the staged changes make sense?

**Mostly yes.** The staged scope is 8 backend app files, 1 migration, 5 backend test files, 65 dispatcher files, 42 driver files, 2 receiver files and 2 shared files. Most changes are wording, fixtures, and presentation.

- Arrival dwell is carried consistently through migration SQL, read model, Pydantic schema/computed average, shared TypeScript type, dispatcher display and OpenAPI snapshot. The new integration test proves the gap between in-transit completion and arrival inspection separately from unloading. The view retains security-invoker behavior and the Data API revoke. This is a sensible functional correction.
- Exception detail now reuses the phase's stored capture-time location assessment for a restricted set of system location finding types. It does not recompute a historical verdict using current data, and unrelated finding types do not borrow it. The changed integration tests cover those distinctions.
- A receipt with an unresolved topic is now shown as pending rather than incorrectly skipped. Skeleton loading states, map remeasurement through ResizeObserver and keyboard resizing are reasonable improvements.
- Wording changes do not by themselves alter the custody/phase contracts.
- Address R7 and R8 before treating the staged UI changes as fully polished. The one-head migration graph and tested view SQL do not replace a complete migration-chain upgrade/downgrade check.

Application code now expects the new arrival columns, so the normal release process must apply the migration before the updated analytics code is served. No migration was applied to a shared database. The repository explicitly prohibits `alembic upgrade` from a feature branch; full-chain release evidence must come from the authorized owner/CI workflow.

## Structure across backend and all frontends

**Keep the present architecture.** The backend has meaningful domain packages, thin routing in the reviewed paths, typed API boundaries, versioned canonical payload reconstruction, and enforceable dependency direction. The 23 passing import contracts and structure/type gates are a substantial improvement over the 19 October audit. Shared frontend types and API wrappers are useful boundaries; driver actor/custody generations and retained offline evidence address real domain complexity.

Target refactoring only where the next fix needs it:

- `audit_packs/builder.py` is 897 lines; separate query context, projections and assembly if changing that workflow.
- `trips/creation.py::persist_trip` is 227 lines; persistence and commitment stages are useful boundaries, while preserving one transaction and locking rules.
- The driver phase route controller is 765 lines, TripContext 667, receiver HandoverPageClient 718, and portal Sections 559. Extract existing state-machine/API/view responsibilities gradually rather than introducing a new abstraction framework before submission.
- Dispatcher AllControls is 1,033 lines but is developer tooling; it has lower submission value than the live driver and receiver flows.
- `app.reporting` is still outside the named global layer list. Add an explicit contract when doing relevant structural work.
- The generic InfoPopover is increasingly imported from an analytics/fleet directory by unrelated screens. Move it to shared UI in a later focused cleanup.

File size is a maintenance signal, not proof of a defect. Do not inflate the fix list with every long function or rewrite historical compatibility code simply to make a file shorter.

## Plans and documentation: what remains, and what should actually be built

The [documentation index](../README.md) explicitly classifies the Iteration 4 plan and research/pivot proposals as unapproved. Their unchecked tasks are not automatically submission requirements. Historical audits are also not current defect lists.

| Document / promise | Current evidence | Submission treatment |
|---|---|---|
| 21 October audit fix plan, especially WI-06/09/10/11/15/18 and older async-JWKS work | Several security tasks remain; R1–R6 and R10 identify current examples | Finish the reproduced security work; update dispositions rather than executing all 30 old work items blindly. |
| 22 October UI/integrity plan | Override order, coded overridden-phase rejection, outer-commit phase publication, receiver cross-check finalization and substitution audit tier fixes are present | Mark those items done with current test evidence. Do not reintroduce the older proposed terminal-status guard: `resolved_at` protects the receiver cross-check while allowing webhook-first resolution. |
| Dedicated arrival phase | Implemented: phase plan/engine/UI/tests, now analytics too | Correct `known-issues.md` §10, which still says not implemented; no new arrival feature is needed. |
| Driver substitution | Implemented across backend, driver, dispatcher and audit records | Correct `known-issues.md` §9's “neither started.” Keep the release/device acceptance matrix open until executed. |
| Client evidence portal | Implemented; 286 tests and production build pass | README line 149 and the architecture/tree are wrong. Document and add portal CI; do not rebuild the feature. |
| Journey lock | New v2 payload commits ordered stops and slot times; v1 stays verifiable. Cargo/phase-plan exclusions are explicit in `crypto/hashing.py` | README's assertion that intermediate stops are outside the current lock is stale. Explain v1 versus v2 accurately rather than claiming a missing feature. |
| Step-event/child ledger and Merkle plan | No generic StepEvent implementation or running Merkle pipeline found; Merkle tables/IDs alone are scaffolding. Current evidence uses phase events, artifacts, custody/exception records and individual anchors | Either explicitly defer the separate child ledger/batching or scope one concrete missing evidence act. Do not build a second ledger or batching system solely because an old plan lists it. Never claim independent step timestamps or Merkle proofs that are not produced. |
| Ed25519 signing | Still not implemented; current hashes/Hedera commitments are different mechanisms | Defer and correct any signing claims. Implement only if the assessed scope specifically requires device signatures. |
| Live integrations | Live PP manifest lookup explicitly raises PPUnsupportedError; live warehouse scan feed raises NotImplementedError. Mock factories are deliberate | Label simulations in the demo and submission. Do not silently replace a failed real provider with mock success or claim these live contracts exist. |
| Incident plan | Build log records stages 1–7 complete; current incident/audit/driver modules support that. Stage 8 anchoring is explicitly after MVP | Demonstrate shortage/hijacking recording and the evidence pack; do not treat all original stage text as unfinished work. Preserve the declared evidence tier. |
| FP-299 concurrent-load validation | Explicitly still pending in `known-issues.md` §4; request budgets and timeout tests are not a load test | Supply a measured concurrency/failure/recovery result if scalability is claimed, or state the limitation in the submission. |
| Notification/call-log proposals | SendGrid exists for audit-pack email codes; that is not a general critical-incident alert channel. A full dispatcher call log is not established by that implementation | Build only if it is in the agreed assessment scope; otherwise list as deferred, with no claims of operational response. |

Current entry-point documents need a reconciliation pass: `CLAUDE.md` still describes two frontends and the pre-arrival phase counts, says CI never runs Alembic although it now does, and contains the ownership placeholder. `known-issues.md` also still describes the empty-string Supabase fallback bug even though the driver now uses `||`. Update current status documents; preserve historical reports as dated evidence. Changes to CLAUDE.md require the project's four-reviewer process.

Do not certify data residency from code or repeat the `af-south-1` claim without deployment evidence. The current assistant documentation also deliberately permits names to reach the model provider; the blanket personal-data-stays-in-PostgreSQL wording must be reconciled with the actual integrations and approved processor policy. This review did not read credentials or inspect the live database region.

## Remaining release evidence

1. Fix R1–R5 and triage/update runtime dependencies. Re-run the failing security reproductions as regression tests and then the existing suites.
2. Repair the two small staged UI cases, add portal CI, and reconcile current README/status claims. Resolve or explicitly defer SLA, signing and child-ledger scope.
3. Obtain the full migration-chain result from the authorized CI/owner workflow, including relevant legacy-data and downgrade behavior. One head and create_all-based tests are insufficient.
4. Execute the driver's native build and physical-device matrix in the [driver transfer release handoff](2026-10-20-driver-transfer-release-acceptance.md#outstanding-gates-for-the-next-chat): online/offline, restart, account/custody changes, receiver QR/consent, cancellation/replacement, two transfers and anchor failure/recovery. A passing static build is not this evidence.
5. Record a complete declared-provider demonstration: normal delivery, seal/count discrepancy, shortage or hijacking record, dispatcher intervention, issued audit pack, portal verification and tamper detection. Record any unverified live-provider and load limitations honestly.

**Review complete; submission approval withheld for the specific findings and unverified release gates above.** No Git write operation, deployment or shared-database mutation was performed. The temporary review databases/container were created only for validation.
