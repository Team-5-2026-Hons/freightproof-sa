# Codebase audit synthesis — 2026-10-21

| | |
|---|---|
| Date | 2026-10-21 |
| Branch | `Ciaran` |
| Commit | `ddfd3810` |
| Code reviewed by the passes | `f4b7360`. `git diff --stat f4b7360 HEAD` shows only the four report files added, so every cited line is still current. |
| Reports present | Pass 2 `2026-10-20-backend-bugs.md` (BK-), Pass 3 `2026-10-20-backend-security.md` (SEC-), Pass 4 `2026-10-20-structure.md` (ST-, FE-01..60), Pass 4b `2026-10-21-frontend-bugs-security.md` (FE-SEC-, FE-BUG-) |
| Reports missing | **Pass 1 `2026-10-20-substitution-bugs.md` (SB-) is absent.** It is not in `docs/reviews/codebase-audit/`, and `docs/audits/` is empty. No SB- finding could be merged or validated. The SB-02 overlap named in the brief could not be checked. |
| Method | Static read only. No source, test or migration edited. No pytest, npm or build run. No git write command. `.env` not read. No subagents used: every status below comes from lines read in this pass. |
| Fix plan | [`2026-10-21-fix-plan.md`](2026-10-21-fix-plan.md) |

ID note: Pass 4 and Pass 4b both use an `FE-` prefix. In this report, `FE-NN` (two digits) is a Pass 4 structure finding, and `FE-SEC-NN` / `FE-BUG-NN` are Pass 4b findings.

---

## a) Summary

The passes raised 58 distinct bug and security issues once overlaps are merged (51 rows in the table below, plus 7 Info notes), 13 doc-drift items, and 124 structure findings.

| Severity (after validation) | Count | Confirmed | Partly confirmed | Not confirmed | Unverified |
|---|---|---|---|---|---|
| Critical | 0 | — | — | — | — |
| High | 5 | 3 | 2 | 0 | 0 |
| Medium | 18 | 15 | 3 | 0 | 0 |
| Low | 26 | 4 | 1 | 1 | 20 |
| Info | 2 rows + 7 notes | 0 | 0 | 0 | 2 (notes taken as written) |
| **Total** | **58** | **22** | **6** | **1** | **22 + 7 notes** |

What changed in validation:

- **BK-02 raised from Medium to High.** The dispatcher UI (`PhaseOverrideAction.tsx:25,44`) offers override on *any* pending row, not only the current one. A misclick on `confirmation` therefore closes the trip with no POD once the driver finishes the earlier phases.
- **FE-BUG-01 stays High, but the path is different.** The report traced an uncoded-409 branch. The live path is a **200**: `gate.py:33-52` returns the trip detail for any already-resolved row, `overridden` included. The driver app reads that 200 as "recorded" (`phase-submitter.ts:329`) and deletes the draft. The 409 branch the report cites is a second, rarer path to the same loss.
- **FE-SEC-02, FE-SEC-03 and FE-SEC-04 lowered from High to Medium.** The data does stay on the device after sign-out. But it is keyed by actor, and no other account can see or send it through the app. Reading it needs device-level access. FE-SEC-04 is also a deliberate FP-83 retention choice.
- **FE-SEC-08 lowered from Medium to Low.** Neither CI nor any in-repo config defines `NEXT_PUBLIC_DEV_PASSWORD`. The only definition is an empty key in `dispatcher/.env.example:17`.
- **BK-14 not confirmed.** `schemas/transit.py:332` sets `min_length=1`, so the API cannot reach the empty-list `rows[0]` case.

Root-cause links (detail in section c):

1. BK-02 and FE-BUG-01 are two halves of one override problem.
2. Fixing BK-05 without BK-03 first would *widen* BK-03.
3. SEC-01, SEC-02 and the rate-limit half of SEC-05 share `core/rate_limit.py`.
4. SEC-06, SEC-07, SEC-11 and FE-SEC-01 all come from the deployed demo running as `ENVIRONMENT=production` with mocks and the dev panel on.

Repeats of older reviews:

- SEC-02 is S4, and SEC-18 is S5, from `docs/reviews/2026-09-14-security-structure-review.md`. Both are still open.
- SEC-13 overlaps S3.
- FE-BUG-02 is the "unchecked `saveQueue`" item from `docs/reviews/2026-09-10-ciaran-branch-review.md:46-48`, still open for checkpoints and locations.
- FE-SEC-04 is the retention half of S8.

---

## b) Distinct issue table

Status: **C** confirmed · **P** partly confirmed · **N** not confirmed · **U** unverified (not re-read in this pass). Test status: a test that would fail if the bug were present, or "none". "Asserts bug" means an existing test pins the current wrong behaviour and must change with the fix.

| ID | Sev | Status | Sources | file:line | Description | Test status |
|---|---|---|---|---|---|---|
| I-01 | High | C | BK-01 | `orchestration/handover/receiver_verification.py:497-503`; `handover/service.py:377,388-393` | `resolve_verification` overwrites a terminal verdict with no status guard and no row lock; every call with an exception type files another `TripException` | none (`test_receiver_verification_endpoints.py:406` makes one call only) |
| I-02 | High | P (Med→High) | BK-02 | `orchestration/phases/override.py:64-72`; `dispatcher/components/domain/PhaseOverrideAction.tsx:25,44` | Override has no lower-sequence check, and the UI offers it on any pending row, so a future phase can be pre-resolved | none (9 test files call override; none overrides out of order) |
| I-03 | High | P (path differs) | FE-BUG-01, ST-42 (status set) | `orchestration/phases/gate.py:33-52`; `driver-pwa/lib/submission/phase-submitter.ts:299-301,329,380-383`; `PhaseStepPageClient.tsx:444-448` | Driver evidence for a row the dispatcher already overrode is discarded with a "recorded" toast. Main path is a 200 replay, not a 409 | asserts bug: `phase-submitter.test.ts:182` ("409 whose addressed phase is already resolved" → recorded) |
| I-04 | High | C | FE-BUG-02; 2026-09-10 review | `driver-pwa/lib/hooks/useOfflineQueue.ts:707,721`; `lib/offline/queue-storage.ts:135-151`; `CheckpointPageClient.tsx:89-94` | Checkpoint and location enqueue ignore a failed `localStorage` write; the driver is told "Saved. Evidence stored on this device." | none (the quota test at `useOfflineQueue.test.ts:748` is for another path; checkpoint tests at :377-399 cover success only) |
| I-05 | High | C | FE-SEC-01 | `driver-pwa/lib/constants/env.ts:2`; `.env.example:2` (`NEXT_PUBLIC_DEMO_MODE=`); `next.config.ts:14-23`; `lib/api/phases.ts:474-477` | Demo mode is on unless the variable is exactly `'false'`; the example config leaves it empty, so demo mode is on; the production guard checks only the API URL | none |
| I-06 | Med | C | SEC-01, SEC-02, SEC-19 (identity log); 2026-09-14 S4 | `core/rate_limit.py:149-155,104-107,158` | Any Bearer header buys a private bucket on public routes; real JWTs share their first 64 chars, so all users share one bucket; that prefix is also logged | none (`test_rate_limit.py:211` uses short distinct fake tokens) |
| I-07 | Med | C | SEC-03 | `orchestration/trips/creation.py:310-311,423-437` (no `Precinct` query in the module) | `POST /trips` accepts another organisation's precinct IDs; the manifest path applies `_visible_to` (`manifest_import.py:63-71`) | none |
| I-08 | Med | C | SEC-04 | `integrations/parcel_perfect/client.py:95-107`; `endpoints/pp.py:57`; `manifest_import.py:99-100`; `tasks/parcel_perfect.py:142-147,177-182` | The PP `token_id` sits in the URL query; `httpx.HTTPStatusError` text includes the URL; four sites log `exc` (`%s` / `%r`) | none |
| I-09 | Med | C | SEC-05 | `main.py:178`; `core/rate_limit.py:179-181` | The 500 handler and the global 429 log `request.url.path`, which carries the raw handover or audit-pack capability token | none |
| I-10 | Med | C | SEC-06, SEC-23 | `dev/endpoints/triggers.py:472,390-395`; `main.py:140-146` | Dev-panel triggers load the trip by ID alone; the panel is mounted in production when `DEV_PANEL_ENABLED` (deliberate, for the demo) | none (`test_dev_triggers.py` has no cross-org case) |
| I-11 | Med | C | SEC-07 | `core/config.py:57,60,65,73`; `core/config_validation.py:90-113` | `*_USE_MOCK` default `True` and are never refused in production; the mock IDVS approves every session | none (`test_config_validation.py` covers live-IDVS credentials only) |
| I-12 | Med | P (High→Med) | FE-SEC-02 | `driver-pwa/lib/context/AuthContext.tsx:151-157`; `lib/api/client.ts:117-128`; `app/(app)/profile/page.tsx:122` | The face photo is cleared only on manual sign-out from the profile page, not on idle expiry or a superseded-device sign-out | none |
| I-13 | Med | P (High→Med) | FE-SEC-03 | `driver-pwa/lib/offline/substitution-store.ts:255` (no caller); `lib/hooks/useSubstitutionCapture.ts:247-253,262-264` | Substitution captures (GPS, seal numbers, result, and full photos when `retained`) are never deleted | none |
| I-14 | Med | P (High→Med, by design) | FE-SEC-04; 2026-09-14 S8 | `driver-pwa/lib/offline/queue-storage.ts:14`; `exception-store.ts`; `AuthContext.tsx:151-157` | Evidence stores are unencrypted and survive sign-out (FP-83 retention; actor-scoped for sending) | none |
| I-15 | Med | C | FE-SEC-05 | `driver-pwa/android/app/src/main/AndroidManifest.xml:5` | `android:allowBackup="true"` puts WebView storage (evidence, refresh token) into Google backup | none |
| I-16 | Med | C | FE-SEC-06 | `driver-pwa/lib/supabase.ts:13`; `dispatcher/lib/supabase/client.ts:34-36`; no `dispatcher/middleware.ts` | Supabase sessions live in `localStorage`; dispatcher route guards are client-only | none |
| I-17 | Med | C | FE-SEC-07 | `dispatcher/next.config.js:3-13`; `driver-pwa/next.config.ts:32-36`; no `public/_headers` | No CSP or HSTS in either app; the driver browser PWA sends no headers at all | none |
| I-18 | Med | C | BK-03, ST-29 (behaviour half) | `orchestration/phases/anchor_dispatch.py:86`; `evidence/action_location.py:484,556`; `phases/completion.py:84-102` | The phase-anchor `after_commit, once=True` listener fires on a savepoint release, so the task publishes before the request commits | none for phases (template: `test_evidence_anchor_recovery.py::test_nested_savepoint_release_does_not_publish_early`) |
| I-19 | Med | C (code) | BK-04 | `tasks/parcel_perfect.py:137-149` | Reads `consignment.id` after `db.rollback()` (expired → `MissingGreenlet` in async); `engine.dispose()` is not in a `finally`. Runtime not reproduced | none (`test_pp_task.py` does not drive a real rollback) |
| I-20 | Med | C | BK-05 (brief names SB-02 as an overlap; Pass 1 absent) | `phases/findings.py:165,259`; `phases/completion.py:84-107`; `evidence/corroboration.py:423,505`; `exceptions/creation.py:100`; `handover/receiver_verification.py:285` | Fail-open `except Exception` around DB writes with no savepoint; a DB error leaves the transaction aborted and the swallow hides it. `completion.py:81-82` comment overstates the savepoint | none |
| I-21 | Med | C | BK-06 | `blockchain/anchor_service.py:89-102` | The `wait_for(to_thread(...))` timeout cannot stop the SDK thread; a retry can publish a second HCS message; the error text claims nothing was saved | none (`test_anchor_service_timeout.py` asserts the exception only) |
| I-22 | Med | C | BK-07 | `orchestration/fleet/drivers.py:142-148`; `vehicles.py`; `precincts.py` (no `with_for_update` in `fleet/`) | Fleet PATCH is read-modify-write without a lock; the anchored diff can misstate the previous value | none |
| I-23 | Med | C | FE-BUG-04 | `driver-pwa/lib/hooks/useOfflineQueue.ts:400-402,427-436`; `lib/api/checkpoints.ts:126-140` | Accepted entries are removed only after the whole pass; a kill mid-flush re-sends them, duplicating checkpoint photo artifacts and GPS rows | none |
| I-24 | Low | P (Med→Low) | FE-SEC-08 | `dispatcher/app/(app)/dev/tokens/page.tsx:15,53-54` | `NEXT_PUBLIC_DEV_*` would be inlined into the bundle despite the runtime `notFound()`; nothing in the repo or CI sets them | none |
| I-25 | Low | C | FE-BUG-03 | `CheckpointPageClient.tsx:85` | Retryable check is `>= 500`, not `isQueueableFailure`, so a status-0 timeout is not queued | none |
| I-26 | Low | C | BK-13 | `orchestration/audit_packs/custody.py:148,151-152` | Substitution tier is derived from the receipt link alone; a missing driver raises `KeyError` | none |
| I-27 | Low | **N** | BK-14 | `exceptions/review.py:341`; `schemas/transit.py:332` | `rows[0]` on an empty batch is unreachable: the schema sets `min_length=1` | n/a |
| I-28 | Low | C | SEC-09 | `handover/receiver_verification.py:546-547` | `hmac.compare_digest` on `str` raises `TypeError` for a non-ASCII `X-Signature` → 500 | none |
| I-29 | Low | C | SEC-13; 2026-09-14 S3; 2026-09-08 dependency audit | `requirements.txt:4,23,24`; `Dockerfile:49` | `python-jose==3.3.0`, `python-multipart==0.0.9` and `gunicorn==22.0.0` (unused: CMD is uvicorn) are pinned with public CVEs | n/a |
| I-30 | Low | U | SEC-18, ST-44 (blocking half); 2026-09-14 S5 | `auth/dependencies.py:86-118` | Unknown `kid` forces a synchronous JWKS fetch on the event loop | — |
| I-31 | Low | U | BK-08 | `tasks/blockchain.py:108-113` et al. | One non-Hedera failure aborts a recovery sweep | — |
| I-32 | Low | U | BK-09 | `db/models/phases.py:45-50` | Global idempotency-key index turns cross-row reuse into a 500 | — |
| I-33 | Low | U | BK-10 | `orchestration/fleet/drivers.py:78-124` | Supabase auth user orphaned on a later failure | — |
| I-34 | Low | U | BK-11 | `blockchain/anchor_service.py:43-58` | Consensus-timestamp parse failure is silent | — |
| I-35 | Low | U | BK-12 | `phases/anchor_execution.py:70-72` | A pre-linked receipt is trusted without a check | — |
| I-36 | Low | U | BK-15 | `evidence_anchors/execution.py:90-95` | Worker log drops the Hedera error detail | — |
| I-37 | Low | U | SEC-08 | `receiver_verification.py:546-579` | `X-Timestamp` is not under the HMAC | — |
| I-38 | Low | U (policy) | SEC-10 | `core/config.py:51` | `SUPABASE_SERVICE_ROLE_KEY` is a config field, against CLAUDE.md (see D-11) | — |
| I-39 | Low | U | SEC-11 | `core/config.py:108,165` | Production checks hinge on the exact string `"production"` | — |
| I-40 | Low | U | SEC-12 | `main.py:268-298,92-98` | `/health` discloses environment and version; CORS `*` methods and headers | — |
| I-41 | Low | U | SEC-14 | `integrations/idvs.py:316-319` | A live capability token is given to Didit as the callback URL | — |
| I-42 | Low | U | SEC-15 | `endpoints/pp.py:42-76`; `consignments/sync.py:368-387` | PP waybill lookup and "already assigned" are not org-scoped | — |
| I-43 | Low | U | SEC-16 | `endpoints/drivers.py:33-38`; `schemas/people.py:57-59` | Every dispatcher can list driver ID, phone and licence numbers | — |
| I-44 | Low | U | SEC-17 | `main.py`; `endpoints/handover.py:435` | No JSON or webhook body size cap | — |
| I-45 | Low | U | FE-BUG-05 | `driver-pwa/lib/api/client.ts:73-78,117-120` | `fp.signedOutReason` is written but never read (the write was seen; the read side was not checked) | — |
| I-46 | Low | U | FE-BUG-06 | `driver-pwa/lib/hooks/usePushNotifications.ts:36,50-54` | Unchecked push `phase_type` cast | — |
| I-47 | Low | U | FE-BUG-07 | `driver-pwa/lib/offline/queue-storage.ts:121-131,186-216` | Post-migration corrupt queue is overwritten | — |
| I-48 | Low | U | FE-SEC-09 | `dispatcher/components/domain/EvidenceDocument.tsx:55,66` | `signed_url` used without a scheme check; iframe not sandboxed | — |
| I-49 | Low | U | FE-SEC-10 | `dispatcher/lib/api/client.ts:37-38,193` | Raw backend `detail` logged to the console | — |
| I-50 | Info | U | SEC-19 (remainder) | `consignments/sync.py:199-202`; `supabase_admin.py:52-54,98` | PP customer names and vendor error bodies in logs | — |
| I-51 | Info | U | SEC-20 | `auth/dependencies.py:207-211`; `endpoints/stream.py:78-86` | Missing credentials answer 403, not 401; SSE outlives the idle timeout | — |
| notes | Info | — | SEC-21, SEC-22, SEC-23, SEC-25, FE-SEC-11, FE-SEC-12, FE-SEC-13 | as cited in the reports | By design, or hardening notes with no defect; taken as written | — |

Leads raised in passing by Pass 2, not counted (Pass 1 territory, not read here): `trips/queries.py:221-233` `max()` on a possibly empty generator; `verification/service.py:252` unchecked `payload_version` key. Pass 4b leads, also not counted: `receiver/app/h/[token]/HandoverPageClient.tsx:36-75` keeps name, ID number and token in `sessionStorage`; `client-portal/lib/api.ts:13-60` keeps an audit-pack grant in `localStorage`.

### Structure findings (ST-, FE-01..60)

The 124 findings were not re-scored. 23 were sampled, including every item the fix plan acts on (the doc-drift set) and FE-36, which the brief flagged.

| Sampled | Verdict | Evidence read |
|---|---|---|
| ST-01 | C | `grep -rl hashlib app` → 18 files |
| ST-03 | C | 8 `db.commit()` in `endpoints/handover.py` |
| ST-04 | C | the only `select(` under `api/` is `endpoints/phases.py:53` |
| ST-14 | C | 13 model files define more than one `__tablename__` (trips 7, driver_substitutions 9, …) |
| ST-15 | C | 48 `except ResourceNotFoundError` under `api/` |
| ST-21 | P | 52 underscore cross-imports by the same grep (report: ~45); the grep pattern is wider, the finding stands |
| ST-25 | C | `app/` holds `analytics`, `dev`, `reporting`, `schemas`, none in the CLAUDE.md diagram; `.importlinter:27` layer order differs from CLAUDE.md |
| ST-26 | C | `crypto/` holds only `hashing.py`; `requirements.txt:22` says pynacl returns "when crypto/ Ed25519 signing lands" |
| ST-29 | C | `anchor_dispatch.py:86` bare `listens_for(..., "after_commit", once=True)` |
| ST-30 | C | `_text` at `anchor_tiers.py:41` and `recording.py:28` |
| ST-33 | C | `"didit"` at `idvs.py:45` and `receiver_verification.py:48` |
| ST-34 | C | `_CRITICAL = "critical"` at `pdf_renderer.py:41`, `analysis.py:54` |
| ST-35 | C | `route_svg.py:20` 111 320.0 vs `polygon.py:25` |
| ST-42 | P | the copies exist, but `phases/state.py:18` already exports a public `RESOLVED_PHASE_STATUSES`; the backend half is partly done |
| ST-61 | C | `tests/baseline/` and `tests/fixtures/` exist |
| FE-01 | C | 21 of 22 dispatcher `page.tsx` start with `'use client'` |
| FE-02 | C (sample of 1) | `components/ui/Skeleton.tsx`: directive, 0 hooks/handlers |
| FE-03 | C | both driver-pwa pages carry the server-component comment and `generateStaticParams` |
| FE-07 | C | 0 non-test importers of `@shared/components` |
| FE-19 | C | `frontend/client-portal/` and `frontend/receiver/` exist |
| FE-36 | C (4 of 26) | `Button`, `GrainToggle`, `EventSwitch`, `PhaseActRow`: no hooks of their own; each only forwards `onChange` / `onOpen` / props. The "leave them" proposal is right: a function prop cannot cross from a Server Component |
| FE-41 | C | `driver-pwa/lib/phase/derive.ts:10-12` comment says the dispatcher excludes `exception`; `dispatcher/lib/phase/derive.ts:28` includes it |
| FE-56 / FE-59 | C | `isRecord` ×3, `truncateHash` ×2 at the cited lines |

---

## c) Validation notes (Critical and High)

There is no Critical finding. Every pass graded none Critical, and validation found nothing that forges or silently destroys anchored evidence. The worst confirmed paths lose evidence *before* it is anchored (I-03, I-04), or let a non-anchored identity verdict be rewritten (I-01).

**I-01 (BK-01) Receiver verdict rewritable.**
- `endpoints/handover.py:388-415`: `POST /{raw_token}/verify/resolve` is public, with only `HANDOVER_PUBLIC` rate limiting.
- `_live_token` → `orchestration/handover/service.py:205-220`: the token is refused only once `redeemed_at` is set or it has expired, so resolve is callable repeatedly for the life of the link.
- `service.py:377`: `load_verification_for_token(db, token_id=token.id)` with no lock (`receiver_verification.py:636-650` supports `lock=True`).
- `receiver_verification.py:458-512`: no `status != PENDING` guard; the five assignments at `:497-502` run on every call.
- Contrast the webhook path at `:617-627`, which annotates instead of overwriting.
- `service.py:388-393`: `raise_verification_exception` runs whenever the verdict has an exception type; `:229-290` inserts a fresh `TripException` with no uniqueness key.
- Consequence: retyping until the name matches flips FAILED to VERIFIED, and leaves one orphan mismatch exception per attempt.
- The resolve route also needs no binding cookie, so anyone holding the link (SEC-14: Didit holds it) can call it.

**I-02 (BK-02) Override skips the sequence gate.**
- `override.py:44-72`: loads the trip (locked), refuses CLOSED/CANCELLED, loads the row, and refuses only if it is not PENDING/IN_PROGRESS. No lower-sequence query.
- Compare `gate.py:84-94`, which refuses a driver completion while any lower row is unresolved.
- `:124` `recompute_position` closes the trip when nothing is left unresolved.
- Dispatcher UI `PhaseOverrideAction.tsx:25,44-45`: shown for any `pending`/`in_progress` row on a non-terminal trip, with no current-phase test.
- Reachable by a misclick, which is why the severity is raised.

**I-03 (FE-BUG-01) Driver evidence discarded on a row resolved by someone else.**
- Backend `gate.py:33-52`: `_is_resolved(event.status)` (COMPLETED, EXCEPTION, OVERRIDDEN) returns `get_trip_detail`, an HTTP 200, before any check of who resolved the row.
- `EVIDENCE_ALREADY_RECORDED` (`core/exceptions.py:410-422`) is raised only for a former driver (`substitutions/access.py:312`), not here.
- Frontend `phase-submitter.ts:321-329`: any non-throwing `submitPhase` returns `{kind: 'recorded'}`.
- `PhaseStepPageClient.tsx:444-458`: `recorded` → `clearDraft(evidence)` and the "recorded" toast.
- The 409 branch at `phase-submitter.ts:357-388` reaches the same outcome through `isResolvedPhase` (`:299-301`).
- Photos may already be stored as artifacts (`lib/api/phases.ts:195-211` uploads them before the POST), but the seal number, notes and phase linkage are lost.
- `phase-submitter.test.ts:182` currently asserts the 409 variant as correct behaviour.

**I-04 (FE-BUG-02) Failed checkpoint/location writes reported as saved.**
- `queue-storage.ts:135-151`: `saveQueue` returns `false` when `setItem` throws.
- `useOfflineQueue.ts:696-724`: `enqueueCheckpoint` and `enqueueLocation` discard that result and return `void`. The comment at `queue-storage.ts:146` ("still updates in memory") is wrong: every read goes back to `loadQueue()`.
- `CheckpointPageClient.tsx:85-94`: success toast, then navigate away.
- `enqueuePhase` and the exception path already report the not-saved state (per Pass 4b; the `not-saved` result shape is visible just above, at `:690`).

**I-05 (FE-SEC-01) Demo mode on by default.**
- `env.ts:2`: `IS_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE !== 'false'`.
- `driver-pwa/.env.example:2`: `NEXT_PUBLIC_DEMO_MODE=` (empty), so a build from the example is in demo mode.
- `lib/auth/defaults.ts:19,25` picks `DemoOtpAuth`; `DemoOtpAuth.ts:34-38` accepts any phone number and OTP.
- `lib/api/phases.ts:474-477` returns `{ok: true}` with no network call.
- `next.config.ts:14-23`: the production guard checks only `NEXT_PUBLIC_API_URL`.

**Links between the Critical/High items (Step 4)**

- **I-02 and I-03 share a root cause.** Both come from "resolved" not saying *who* resolved the row. One backend change, refusing a driver completion on a row someone else resolved with a coded 409 while keeping the own-replay 200, plus the matching frontend handling, closes I-03 for both branches. The override gate closes I-02. Do them as two PRs, back to back.
  - **Break risk:** the own-replay 200 is load-bearing for the offline queue (`gate.py:96-99` comment; `test_an_idempotent_replay_of_a_completed_phase_does_not_409`). Any backend change must keep it.
- **I-01 stands alone.** But its file is also touched by I-20 (`receiver_verification.py:285`) and SEC-09 (`:547`), so those follow it.
- **I-04 and I-23 share `useOfflineQueue.ts`;** do I-04 first. FE-12 (move the engine out of the hook) would conflict with both and is blocked anyway.
- **I-05 is the frontend twin of I-10 and I-11.** All three exist because the demo deployment is "production with mocks". The fix is one team decision about how the demo is built and deployed, then three small changes.
- **Not Critical/High, but a break risk worth stating:** wrapping the fail-open writes in savepoints (I-20) adds savepoint releases *after* `_anchor_phase`/`_dispatch_anchor` has registered its listener. That makes the early publish in I-18 happen on every handshake that records a finding, not only on separation findings. I-18 must land first, or in the same PR.

---

## d) Doc drift (CLAUDE.md statements the code contradicts)

| ID | CLAUDE.md says | Code says | Verdict | Sources |
|---|---|---|---|---|
| D-01 | `crypto/ Ed25519 (PyNaCl), SHA-256, Merkle` | `crypto/` is `hashing.py` only; no `nacl`/`ed25519` anywhere in `app/`; `requirements.txt:22` "pynacl returns when crypto/ Ed25519 signing lands" | **Doc drift, plus an unbuilt feature.** Nothing in the code needs signing today (hashes go to HCS; the webhook uses HMAC). Whether Ed25519 signing is still planned is a team decision; the doc should say "SHA-256 canonical hashing; signing not implemented" until then. No Merkle code was found either (`merkle_batch_id: null` in `driver-pwa/lib/api/checkpoints.ts`) | ST-26; Pass 2 §D |
| D-02 | "Receiver = one-time OTP" | Rotating 256-bit capability token, HttpOnly binding cookie, optional IDVS (`capability.py`, `endpoints/handover.py`) | **Doc drift** (the code is stronger than the doc). The only OTP is the audit-pack email code | SEC-24, ST-26 |
| D-03 | "Guard page = zero login" | No guard route in the backend; no guard app or page in `frontend/` | **Real gap or retired scope:** the documented role has no implementation. Team decision: drop it from CLAUDE.md, or keep it as planned work | SEC-24, Pass 3 table |
| D-04 | Phase list P0–P6, "single-leg = 7 rows, 3-stop cross-dock = 11" | `arrival` added; `plan.py:57` "2 stops -> 8 rows, 3-stop cross-dock -> 13"; `test_phase_plan.py:17` | Doc drift | BK-16 |
| D-05 | `integrations/ pulse.py, parcel_perfect.py, idvs.py, twilio.py, sendgrid.py` | `pulsit.py`, `parcel_perfect/` package, `idvs.py`, `sendgrid.py`, `supabase_admin.py`, `scan_feed.py`, `mock_state.py`, `routing.py`; no Twilio | Doc drift | ST-26 |
| D-06 | Architecture tree and layering line | Also `analytics/`, `dev/`, `reporting/`, `schemas/`; `auth` sits below orchestration in `.importlinter:27`; `reporting` is in no contract | Doc drift (`.importlinter` is the enforced truth) | ST-25, ST-22 |
| D-07 | "`db/` never imports from elsewhere in `app/`" | `db/session.py:12` → `core.config`, allowed by the contract | Doc drift (one word too strong) | ST §A.3 |
| D-08 | `db/models/` one file per table | 13 of 16 files hold several tables (per aggregate) | Doc drift | ST-14 |
| D-09 | Tests: `unit/`, `integration/` | Also `baseline/` (B1/B2/B3/B8 gates) and `fixtures/` | Doc drift | ST-61 |
| D-10 | Dispatcher: async Server Components where possible, `"use client"` at the lowest level | 21 of 22 pages and the auth layout are client; architecture-level, not per-page | Rule vs code; needs the FE-01 decision | FE-01 |
| D-11 | driver-pwa: `"use client"` on every page | 2 pages are Server Components by necessity (`generateStaticParams`) | Doc drift | FE-03 |
| D-12 | Frontends: `dispatcher/`, `driver-pwa/` | Also `client-portal/` and `receiver/` | Doc drift | FE-19 |
| D-13 | "The Supabase `service_role` key never appears in code or config" | `core/config.py:51` field, used by storage and Supabase admin | Policy vs code; decide which changes | SEC-10 |

Smaller docstring and comment drift that is not in CLAUDE.md (fix inside the related work item): `completion.py:81-82` savepoint claim (BK-16/BK-05); `test_trip_admin.py:271-278` "never anchored" (BK-16); `blockchain/anchor_service.py:1`, `dev/services/truck.py:8`, `dev/endpoints/pulsit.py:213` (ST-27); `driver-pwa/lib/phase/derive.ts:10-12` (FE-41); `queue-storage.ts:146` "still updates in memory" (new, this pass).

---

## e) Not doing

**Rejected**
- **BK-14:** not reachable; the batch-review schema's `exception_ids` has `min_length=1` (`schemas/transit.py:332`).

**Unverified (not re-read this pass; kept out of the plan until someone traces them)**
- I-30 to I-51: BK-08, BK-09, BK-10, BK-11, BK-12, BK-15, SEC-08, SEC-10, SEC-11 (carried into WI-16 only as a decision input), SEC-12, SEC-14, SEC-15, SEC-16, SEC-17, SEC-18, SEC-19 remainder, SEC-20, FE-BUG-05, FE-BUG-06, FE-BUG-07, FE-SEC-09, FE-SEC-10.
- Most are Low, graded Verified or Likely by their pass. SEC-18 is also open from the 2026-09-14 review (S5) and is the best candidate to verify next.
- BK-09's fix may need a migration (index scope), so it needs a named developer before planning.

**Deferred (confirmed, but blocked on a decision or out of scope for a fix PR)**
- FE-SEC-04 at-rest encryption (I-14): a design decision about FP-83 retention and native secure storage.
- FE-SEC-06 / FE-SEC-07 dispatcher cookie sessions and CSP (I-16, I-17): an architecture change, and likely a new dependency (`@supabase/ssr`, so `package.json` is touched, a shared file).
- BK-06 duplicate-message reconciliation (I-21): only the message reword and documentation are planned; mirror-node reconciliation needs a design decision.
- All 124 structure findings: blocked behind the freeze (19 Oct to after the 22 Oct demo) and the ST-02 / FE-01 decisions. ST-36 (four UTC serialisers) is explicitly *keep, do not merge*: merging changes anchored hashes.
- Pass 1 (substitution bugs): absent. No substitution-specific item is planned beyond I-13 and I-26. The 2026-10-20 driver-transfer independent review lists its own open release blockers; it was read only to the findings list and is not re-reported here.

**Not covered by any present pass, so not planned**: `frontend/receiver`, `frontend/client-portal` (two leads above), dispatcher stale-data after mutations, Android/iOS native beyond the manifest.

---

## f) Coverage

**Files read in this pass (about 60).**

Reports and docs:
- The four audit reports, in full.
- `CLAUDE.md` and `graphify-out/GRAPH_REPORT.md`: header and hubs only. The graph is built from `5d906bc5` and is stale against `f4b7360`; it was used for orientation only.
- `docs/reviews/2026-10-20-driver-transfer-independent-review.md`: findings section only.
- `docs/reviews/2026-09-14-security-structure-review.md` and `2026-09-10-ciaran-branch-review.md`, `docs/dependency-security-audit-2026-09-08.md`, and `docs/design-notes/2026-10-06-backend-structure-tech-debt-audit.md`: grep and the cited sections only.

Backend, at the cited ranges: `orchestration/handover/{receiver_verification,service}.py`, `api/v1/endpoints/{handover,pp}.py`, `orchestration/phases/{gate,override,anchor_dispatch,completion,plan,state}.py` (plus `advance_departure.py` by grep), `core/{rate_limit,config,config_validation,exceptions}.py`, `main.py`, `orchestration/trips/creation.py` (grep), `orchestration/consignments/manifest_import.py`, `integrations/parcel_perfect/client.py`, `tasks/parcel_perfect.py`, `dev/endpoints/triggers.py`, `dev/schemas.py`, `blockchain/anchor_service.py`, `orchestration/fleet/drivers.py`, `orchestration/exceptions/review.py`, `orchestration/audit_packs/custody.py`, `schemas/{trips,transit}.py` (grep), `requirements.txt`, `Dockerfile`, `.importlinter` (grep).

Frontend: `driver-pwa/lib/{constants/env,auth/defaults,auth/DemoOtpAuth,api/phases,api/client,api/checkpoints,submission/phase-submitter,hooks/useOfflineQueue,offline/queue-storage,offline/substitution-store,hooks/useSubstitutionCapture,context/AuthContext,profile/driver-photo,supabase,phase/derive}.ts(x)`, `PhaseStepPageClient.tsx`, `CheckpointPageClient.tsx`, `next.config.ts`, `.env.example`, `AndroidManifest.xml`; `dispatcher/{next.config.js,lib/supabase/client.ts,app/(app)/dev/tokens/page.tsx,components/domain/PhaseOverrideAction.tsx,lib/phase/derive.ts,components/analytics/fleet/controls/{GrainToggle,EventSwitch}.tsx}`, plus greps over `components/` for the FE samples.

Tests, by grep or at cited lines: `tests/unit/test_rate_limit.py`, `tests/unit/test_config_validation.py`, `tests/integration/{test_receiver_verification_endpoints,test_trip_admin,test_gps_mismatch,test_dev_triggers}.py`, `driver-pwa/lib/submission/__tests__/phase-submitter.test.ts`, `driver-pwa/lib/hooks/__tests__/useOfflineQueue.test.ts`.

**Subagent summaries used:** none in this pass. The passes themselves leaned on Sonnet inventories (route, sink, storage, size, duplication). Where a finding rested on one of those and this pass did not re-read the lines, it is marked U.

**Not checked:**
- Runtime behaviour. Nothing was run, so I-19's `MissingGreenlet` and I-18's early publish rest on SQLAlchemy semantics this repo documents and tests elsewhere.
- Whether a Supabase JWT header exceeds 64 characters, checked by arithmetic only, not against a live token.
- The Railway, Vercel or host header configuration (I-17).
- The CI secret store (I-24).
- Every U row above; 101 of the 124 structure findings.
