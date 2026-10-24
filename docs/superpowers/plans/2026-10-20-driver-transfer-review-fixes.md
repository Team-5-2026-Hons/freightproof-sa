# Driver Transfer Review Fixes Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans task-by-task. User explicitly authorized planning and execution in this chat on their Ciaran branch.

**Goal:** Close the three reproduced account/custody/replay gaps without weakening authorization or losing evidence.

**Architecture:** Reject stale account responses at API/UI boundaries, rotate mounted capture scope when provenance changes, and carry the original submission key into offline storage. Preserve existing storage formats and server checks; no schema changes.

**Tech Stack:** Existing React 19 / TypeScript / Next.js driver PWA, Vitest, Python backend tests.

**Spec:** The three findings and agreed fixes in this chat; docs/contracts/driver-substitution-v2.md.

## Global Constraints

- Work in the user's existing Ciaran checkout; no branch changes, commits, staging, pushes, migrations, or shared database mutations.
- Preserve unrelated untracked files. Never read/print .env files or secrets.
- Keep original actors, custody sequences, capture bytes and replay keys. No canonical payload changes.
- Preserve legacy drafts/queues. Failed retention must never permit overwriting original evidence.

## Review Focus

- Account changes during successful response/body reads, including A→B→A: reject stale data.
- Old provider responses, failures and finalizers must not mutate another account's state.
- Mounted period-0 drafts discovered at period 2: retain original bytes, reset the form, reject stale edit/clear callbacks.
- Quota failures during retention: leave originals untouched and refuse conflicting writes.
- Online completion with a lost response: replay with the original key, including after transfer; never regenerate existing queue keys.

### Task 1: Bind asynchronous results to their originating account

Files: driver-pwa/lib/api/client.ts; lib/context/DriverSubstitutionContext.tsx; lib/context/TripContext.tsx; lib/submission/phase-submitter.ts; relevant tests. Add a small shared account guard hook if useful.

Interfaces: existing actorGeneration(), AuthContext identity and provider public APIs remain unchanged.

- [x] Add deferred-response/body and provider account-switch tests; stale data must never appear and newer state must survive stale failures.
- [x] Run targeted tests. Expected: assertion failures reproducing the gaps.
- [x] Guard asynchronous boundaries, response consumption, provider state changes and submission outcomes.
- [x] Run targeted tests. Expected: pass; normal same-account refresh/authentication retry preserved.

### Task 2: Rotate mounted capture scope safely

Files: driver-pwa/lib/hooks/usePhaseDraft.ts; lib/offline/retained-drafts.ts; app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx; relevant tests.

Interfaces: keep usePhaseDraft's tuple API and existing v2/retained storage formats. Add provenance-checked removal if needed.

- [x] Test mounted custody/account changes, null→0 compatibility, stale edit/clear callbacks and quota-failed retention; assert old bytes cannot be reattributed or overwritten.
- [x] Run targeted tests. Expected: assertion failures.
- [x] Reset form/controller scope on actor/custody changes, retain old evidence, and guard stale capture/submit callbacks.
- [x] Run targeted tests. Expected: pass, including legacy and multi-phase persistence cases.

### Task 3: Preserve submission identity during offline fallback

Files: driver-pwa/lib/hooks/useOfflineQueue.ts; lib/submission/phase-submitter.ts; queue/submitter tests.

Interfaces: append optional original replay key to enqueuePhase; callers without one generate a fresh key. Stored entries retain their existing keys.

- [x] Exercise startPhaseSubmission through the real queue/flush after a lost response and an actor-bound duplicate acknowledgement. Cover account/custody retention paths.
- [x] Run targeted tests. Expected: original-key assertion fails.
- [x] Carry the original key through every enqueue path; keep queue identity independent from the wire key.
- [x] Run targeted tests. Expected: original key/provenance preserved and only acknowledged entries cleared.

### Verification and Review

- [x] Run full driver suite, TypeScript and lint; report pre-existing failures explicitly.
- [x] Verify backend custody/replay tests using a source copy without environment files and disposable Postgres/Redis only.
- [x] Review the final diff for stale callbacks, failed storage writes and compatibility.
- [x] Report changed files/results; leave changes uncommitted.

## Execution Ledger

- User authorized the described design and inline execution. Skill commit/worktree/approval suggestions yield to the user's chosen checkout and repository Git restrictions.

- Task 1: deferred API/provider tests reproduced eight failures before account guards; targeted checks passed after implementation. Guards cover headers, JSON bodies, provider callbacks, and submission outcomes, including A→B→A.
- Task 2: draft and controller tests reproduced stale custody/account failures before changes. Original storage survives retention quota failures; stale callbacks cannot edit or clear newer evidence; legacy null→0 drafts remain usable and clearable.
- Task 3: three real-queue fallback tests first failed on regenerated keys. Original wire keys now survive network, custody and account fallback, and actor/key-bound duplicate acknowledgement clears only the acknowledged queue entry.
- Independent final review requested changes for four additional boundary cases: a late completion clearing a newer same-period draft, an obsolete optimistic custody marker, old-account submission failure state leaking into the new account, and legacy null→0 cleanup. Added regressions (four failing assertions), then corrected all four in one fix pass. The reviewer reported no minor suggestions. Its backend scope was limited to key propagation; the full isolated backend suite supplies broader custody/replay/hash/migration regression evidence. No subsequent review dispatch.
- One full-suite run exposed a test-harness race: background queue retries received an undefined mock result and cleared the entry. The mock now consistently fails offline until the test explicitly supplies a receipt. Every attempted wire key is still asserted equal to the original; no assertions were skipped or weakened to allow a different key.

## Initial Verification (before independent follow-up findings)

- Driver: `node node_modules/vitest/vitest.mjs run --cache=false --reporter=dot` — **164 files, 1,589 tests passed**, no skipped driver tests.
- Types: `node node_modules/typescript/bin/tsc --noEmit --incremental false` — **PASS**, exit 0.
- Lint: full driver ESLint — **0 errors**, one pre-existing `next/no-img-element` warning in `app/(app)/trip/in-transit/exception/__tests__/LogExceptionPageClient.test.tsx:77`. Latest queue test also linted separately.
- Backend: full `python -m pytest -p no:cacheprovider -q` — **4,070 passed, 4 skipped**, exit 0. Used a secret-free temporary source copy at `/private/tmp/fp83-fixes-backend-c1gg6b8h` and disposable PostgreSQL/Redis; both temporary service containers were stopped afterward. No project/shared database was accessed. Existing test warnings include jose datetime deprecation, Pydantic serializer warnings and async mock/Redis teardown noise.
- Backend, canonical serialization/hashes, migration chain and requirements were not modified. No skip markers were added.
- `git diff --check` — **PASS**. Branch remains `Ciaran` at `05c57d3b`; changes remain unstaged and uncommitted. Unrelated untracked files preserved.

## Initial completion record (superseded by follow-up)

Summary: Completed the three driver-transfer fixes and four boundary cases found during independent review. Account callbacks are scoped to their original session, draft evidence is retained across custody changes without stale cleanup loss, and online fallback preserves the original replay key.

Modified: driver API client; substitution and trip contexts; draft/queue hooks; retained-draft storage; phase submitter; phase step controller; seven existing regression test files.
Created: this plan; `frontend/driver-pwa/lib/session/useAccountGuard.ts`; `frontend/driver-pwa/lib/submission/__tests__/phase-submitter-queue.test.ts`.
Tests: API client, substitution context, trip handover context, phase drafts, phase step controller, phase submitter, actor-bound submissions and real offline queue fallback.
Excluded: backend and migration edits (unnecessary); unrelated untracked files (outside scope).

Self-review: PASS for scope, TypeScript without new `any`, explanatory comments, no hardcoded secrets, guarded errors, regression coverage, full pytest, no Git write operations and shared-file policy. Database/model/endpoint/schema/dependency-version checks are unchanged and not applicable to this frontend-only change.
Result: PASS.
Migrations: none.
Shared files: none.
Deprecations: no new deprecated APIs; existing backend warning noted above.
New .env keys: none.
Suggested commit: `fix(driver): preserve account custody and replay boundaries`.
Files are unstaged and uncommitted under repository/user instructions; no Git write commands were run.
Next: review the local diff, then smoke-test driver switching and phase capture in the browser before integrating through the team's normal process.

## Independent Review Follow-up — 2026-10-20

The user supplied two additional P1 findings and authorized fixing both in this chat on `Ciaran`. The initial completion assessment missed these boundaries; its passing test counts did not establish their safety.

### Requirements and implementation

- [x] Reproduce overlapping period-0 / period-2 submissions under the same account generation. Scope deduplication, in-flight ownership and failure settlement to generation, actor, trip, custody sequence and phase. Legacy null and sequence 0 denote the same original period.
- [x] Exercise the real `submitPhase` → `uploadArtifact` → completion path through live submission and queue flush, mocking only HTTP. A duplicate artifact receipt supplies an artifact ID; it never directly acknowledges the phase. The phase completion still sends its original key and original custody sequence. A phase custody refusal retains the entire evidence entry; only its completion acknowledgement clears it.
- [x] Keep a missing artifact receipt from propagating as a whole-phase duplicate. Required-photo evidence remains in the queue or live draft when no artifact ID is returned. The existing optional-PDF omission policy remains unchanged and still requires successful phase completion.
- [x] Notify mounted submission-status consumers when the selected trip/period changes, independently from account-change listeners that trigger queue work.
- [x] Preserve scoped pending attempts and failure notices while another trip is selected; switching back recovers them. Visibility filtering must not delete ownership state.
- [x] Finish final full driver suite, TypeScript, ESLint and disposable-service backend suite; record results below.

### Reproduction and review evidence

- Initial regression run: **7 failed, 5 passed**. Four live/queue artifact tests observed no completion POST; one missing-artifact-receipt test observed queue deletion; two custody tests observed obsolete in-flight state.
- After the first implementation: targeted **81 passed** and full driver **1,596 passed**. Independent review then identified two P2 issues in the scoped-store change: missing custody subscription notifications and destructive pruning of another selected trip's state.
- Notification regressions failed twice before adding the deferred trip-custody event. A trip-return regression failed before separating stored attempts from snapshot visibility. Expanded cases exposed five failures involving sequence 0/null visibility and failure settlement while another trip was selected; these now retain scoped records and check the selected trip explicitly.
- Targeted current store/banner verification: **35 passed** (14 actor/custody cases plus 21 banner cases). Includes both settlement orders, same-period dedupe, null→0 compatibility, six pending/failed trip-return cases, and a mounted banner updating without remounting.
- One full-suite pass attempt exposed three banner fixtures that authenticated an account without loading any trip context. Updated setup to represent the real app's trip scope; all original assertions remain. Added the mounted-banner regression. No skipped tests or relaxed evidence/key assertions.
- Independent reviewer reported no other blocking findings in artifact receipt handling or settlement ownership. Both P2 findings are addressed above with failing-then-passing regressions. Parent is performing final diff review after that fix pass.

### Follow-up verification

- Full driver run: `node node_modules/vitest/vitest.mjs run --cache=false --reporter=dot` — **1,604 passed across 165 files**, exit 0; no driver skips.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit --incremental false` — **PASS**, exit 0.
- Full ESLint: **0 errors**, the same existing `next/no-img-element` warning at `app/(app)/trip/in-transit/exception/__tests__/LogExceptionPageClient.test.tsx:77`.
- Parent final diff review: scoped keys preserve newer attempt ownership; trip/period events notify existing subscribers; visibility never deletes another selected trip's pending/failure state; incomplete required-artifact receipts cannot become whole-phase acknowledgements. Backend artifact receipts match actor + phase + role + byte hash; phase completion remains a separate request with its original key. Checkpoint/exception uploads are unattributed and do not use the backend's attributed-artifact replay lookup, so this specific duplicate-receipt boundary does not arise there.
- `git diff --check` — **PASS**. No backend/shared/dependency changes and no staged changes.
- Backend: full `python -m pytest -p no:cacheprovider -q` — **4,070 passed, 4 skipped, 2,126 warnings**, exit 0 in 336.74 seconds. Used only `fp83-gaps-postgres` / `fp83-gaps-redis`, the secret-free temporary source copy and explicit localhost URLs. Both disposable service containers were stopped successfully afterward. Existing jose/Pydantic/async-mock warnings and Redis teardown noise remain; their count matches the earlier run. No skip markers were added or integration tests bypassed for these changes.

## TASK COMPLETE — follow-up

Summary: Fixed both P1 findings and the two P2 state-management issues found during independent review of this fix pass. Custody-period submissions no longer block or settle each other's state. Artifact receipts acknowledge only artifacts; phase completion still uses the original phase key and custody period, and refused or unconfirmed evidence is preserved.

Modified / Created / Tests: listed under Follow-up changed files above, alongside the existing earlier driver-transfer changes. All production changes are in the driver PWA; the new artifact regression file exercises real submitter/API/queue code with only HTTP mocked. No existing test assertions were removed or relaxed.
Excluded: backend, shared schemas/files, migration chain, dependency manifests, deployment and unrelated untracked files.
Self-review: PASS — requested scope, typed production interfaces without new `any`, explanatory boundary comments, no credentials/config additions, error/evidence preservation, regression coverage, fresh full frontend/backend checks, no Git writes and shared-file policy. DB/model/endpoint/dependency-version implementation checks are unchanged and not applicable.
Result: PASS.
Migrations: none.
Shared files: none.
Deprecations: no new deprecated APIs; existing Vite CJS and backend jose warning paths remain.
New .env keys: none.
Suggested commit: `fix(driver-pwa): scope custody submissions and phase receipts`.
Changes remain unstaged and uncommitted on `Ciaran` at `05c57d3b`; no Git history/state or shared database mutations were performed.
Next: review the local diff and use the team's normal integration process. Automated checks do not replace a manual browser/device smoke test of account switching, driver transfer and offline capture.

### Follow-up changed files

- `frontend/driver-pwa/lib/submission/phase-submitter.ts`: scoped attempts, dedupe and settlement, stable filtered snapshots.
- `frontend/driver-pwa/lib/session/custody-context.ts`: deferred trip/period notification and explicit selected-trip custody predicate; capture stamping remains unchanged.
- `frontend/driver-pwa/lib/api/phases.ts`: consume artifact replay receipts at the artifact boundary, then continue phase completion with the original key.
- `frontend/driver-pwa/app/(app)/trip/phase/[type]/step/[slug]/PhaseStepPageClient.tsx`: align dedupe comment with account/custody scope; no additional controller logic changes.
- `frontend/driver-pwa/lib/submission/__tests__/phase-submitter-actor.test.ts`: custody overlap, settlement order, trip-return and legacy regressions.
- `frontend/driver-pwa/lib/submission/__tests__/phase-artifact-replay.test.ts` (new): five real artifact/phase/queue boundary cases.
- `frontend/driver-pwa/components/layout/__tests__/OfflineBanner.test.tsx`: accurate trip fixture plus mounted custody-change regression.

Backend code, hashes/canonical payload definitions, migration chain, dependency manifests and shared files are excluded. Existing unrelated untracked files remain untouched.
