# Current validation — 20 October 2026

This section supersedes the historical T1–T4 status below. Ciaran owns all current changes/migrations and will apply migrations only after review. The immediate v2 flow requires incoming B acceptance; outgoing A is notified and supplies no confirmation/GPS. Legacy v1 remains readable and replayable.

Full results, changed files, migration limits and the next-chat prompt: [driver-transfer verification handoff](../../../docs/reviews/2026-10-20-driver-transfer-release-acceptance.md).

- Stop-hook follow-up: complete backend unit suite **1,902 passed, 4 skipped** on disposable PG14 with dotenv disabled; three contract assertions updated and five existing scan-store unit fixtures wired in. Sandbox DB setup errors reproduced separately; hook unchanged.
- Final scoped driver run: **157 passed** (15 files).
- Full driver run: **1,474 passed, 80 failed** (10 failing files); failures remain open, including existing custody/draft/router expectations. Do not count the full suite as passed.
- Driver typecheck passed; ESLint 0 errors/1 existing warning.
- Driver production build failed API URL validation in this environment. Capacitor sync/install and physical acceptance were not run.
- Final scoped backend run: **519 passed** on disposable PG14, including lifecycle/access/audit/receiver-consent race/v2 migration shape. This does not establish PG17 full-chain migration acceptance.
- Dispatcher full suite **2,953 passed**; subsequent row/timeline keyboard run **127 passed**, including two new row tests. Dispatcher typecheck passed; ESLint 0 errors/2 existing warnings; build failed Google Fonts network access.
- Actual sample timestamps/reasons, actor generations and stale-profile/send guards have regression tests. Opening the transfer page does not trigger automatic navigation GPS; B's explicit capture still uses the observation adapter.
- No shared migration or production enablement occurred. **Verify in the new chat before migrating. Current release decision: BLOCK CANDIDATE RELEASE pending remaining safety/full-suite/device evidence.**

Outstanding: complete independent review; full PG17/Redis and migration-chain verification; remaining legacy/mixed-chain/flag-off/concurrency vectors; actual responsive/keyboard detail checks; all native/two-phone, offline/restart, A→B→A, receiver, hold and anchor-outage acceptance. Synthetic/unit checks are not substitutes for physical evidence.

---

## Historical driver implementation record (retained for provenance)

# FP-83 driver app: implementation handoff and validation record

**Owner:** Tim (driver app). **For:** Ciaran (C6 contract check, then C8 combined release verification).
**Plan:** [`docs/superpowers/plans/2026-10-18-driver-substitution-driver-app.md`](../../../docs/superpowers/plans/2026-10-18-driver-substitution-driver-app.md).
**Contract:** [`docs/contracts/driver-substitution-v1.md`](../../../docs/contracts/driver-substitution-v1.md) (v1, unchanged by this work).

This is the short validation record T4 asks for. It does not change the feature spec.

## Status

| Task | Code | Tests | Verified against the real backend |
|---|---|---|---|
| T1 Assignments, notices, history | Done | Written, passing | No (backend endpoints not built) |
| T2 Handover and takeover capture | Done | **Not written yet** | No |
| T3 Offline queues and drafts that track custody | Done | **Not written yet** | No |
| T4 Integrate, validate and report | This record only | n/a | **Not started**: needs C6/C7 |

T2/T3 tests are deferred on purpose and still owed (see the end of this document). Nothing in this record counts as proof that the real endpoints work.

## Checks run

From `frontend/driver-pwa`:

- `npx tsc --noEmit`: passes.
- `npx eslint .`: 0 errors (1 warning that was already there, in a test file).
- `NEXT_PUBLIC_API_URL=<placeholder> npm run build`: passes. `/trips/substitution` and `/evidence` export as static pages.
- `npm test`: **not run** for T2/T3 (deferred). Some existing tests are expected to fail until they are updated; see "Existing tests to update".

## What was built

### T2: capture (`components/trip/DriverSubstitutionFlow.tsx`, `lib/hooks/useSubstitutionCapture.ts`, `app/(app)/trips/substitution/`)
- Each driver records their own check on their own phone: every assigned vehicle confirmed; a seal check per trailer (or the horse if there are no trailers) using `SubstitutionSealCondition`, with a per-vehicle `not_applicable_reason`, normalised `XX-####` numbers, and photo rules as in the contract; an optional discrepancy note; capture time; and position, or `null` together when unavailable.
- The draft is persisted in IndexedDB (`lib/offline/substitution-store.ts`) before anything is sent. Pressing confirm fixes the body and a new `client_request_id`. Retries resend the identical body and key. Each photo has its own stable upload `client_request_id`.
- Uploads use `POST /trips/me/{trip}/driver-substitutions/{request}/artifacts`, never `/artifacts`.
- A `200` response is always "saved". A pending response shows `missing_confirmations` / `completion_blocked_by` truthfully. A completed response refreshes trip and substitution state before showing the incoming driver's trip link. The outgoing driver's working trip is dropped and they are pointed to their record.
- `SUBSTITUTION_VERSION_CHANGED`: the capture is kept and returns to draft, and the arrangement is refetched. `SUBSTITUTION_NOT_PENDING`: the capture is retained and never reused against a replacement request. `IDEMPOTENCY_KEY_REUSED`: the draft is kept and the next press is a new action.
- A declaration already submitted is shown read-only. The other driver's declaration is shown "for comparison only".
- Confirmations pressed while offline are resent on the substitution refresh (foreground, reconnect, interval).

### T3: custody-aware queues (`lib/offline/*`, `lib/session/custody-context.ts`)
- Every new live write carries `custody_sequence`, captured at the moment of capture and never re-read at send time. This covers phase completion, checkpoints, location batches, exceptions, artifact uploads and receiver-handover token issue.
- The queue no longer treats every 409 as "already landed". `EVIDENCE_ALREADY_RECORDED` clears only the item that was sent. Every other refusal is kept as needs-attention with its code and reason. Network, 429 and 5xx retry as before.
- Captures are bound to the account that took them. A capture is sent only when that account is signed in, never replayed with another driver's token.
- Versioned migration (`fp_offline_queue_version = 2`, `fp_draft_version = 2`, exception envelopes):
  - Entries with no recorded capturer are **quarantined**, with bytes and metadata kept.
  - Malformed entries are wrapped as "unreadable".
  - A queue value that can't be parsed is backed up before anything overwrites it.
  - The migration can be rerun, and nothing is deleted until its copy is durable.
- Phase drafts record actor and custody period. A draft from another account, an unknown capturer or an earlier period of the same driver (A→B→A) is moved to a retained record, not loaded into the step.
- Review screen `/evidence`: per-item **Send as late evidence** (actor-bound, original sequence, dedicated late artifact and payload routes), **Try again** (non-custody refusals), **Export** (JSON) and **Discard** (two taps with a warning). Captures belonging to another account are counted but never listed.
- Late-evidence progress (request id, per-photo upload ids, receipt) is saved before sending. Local bytes are cleared only after a receipt or `EVIDENCE_ALREADY_RECORDED`.

## Contract points to confirm with Ciaran (C6)

These are my readings of the contract. I assumed the backend matches them, but please confirm.

1. **`custody_sequence` on existing live writes.** Sent as a top-level body field on phase complete, checkpoint, exception, the location batch (`{pings, custody_sequence}`) and receiver-handover token issue (JSON body `{custody_sequence}` on a POST that had no body before). Sent as a form field on `/artifacts`. It is omitted, not sent as `null`, when unknown.
2. **Late-evidence artifact form.** It uses the existing fields (`artifact_type`, `captured_at`, optional `captured_lat`/`captured_lng`, `file`) plus `client_request_id` and `custody_sequence`. It does not send `trip_id` (it is in the path), `phase_event_id` or `evidence_role`.
3. **Reusing earlier artifact ids in late evidence.** Photos already uploaded through `/artifacts` before the handover (by the same driver) are referenced by their existing ids in `artifact_ids` and in the payload, not re-uploaded. Please confirm the server accepts this.
4. **Embedded late payloads.** These are the existing request bodies with `custody_sequence` removed, since late evidence carries it at the top level. For a location batch, `captured_at` is the earliest ping, and `original_idempotency_key` is `null`.
5. **Substitution artifact form.** The existing fields plus `client_request_id` and `role`. No `trip_id` or `phase_event_id`.
6. **Where the custody sequence comes from.** Read from `trip.driver_access.custody_sequence`, then `trip.custody_sequence`, on the current-driver trip read.

## T4 checklist: not yet done (needs C6/C7 and a real backend)

- [ ] OpenAPI vs shared fixtures, multipart shapes, current/pending/former/unrelated accounts, all conflict codes.
- [ ] Ordinary handover, missing-confirmation completion, unavailable/failed identity, replaced arrangement, driver with no current trip, phase partly captured, app restart, two successive transfers.
- [ ] Stale work from an earlier custody sequence refused after A→B→A. Former history excludes later live data.
- [ ] Full `npm test`, `type-check`, `lint`, `build` (only type-check, lint and build have been run).
- [ ] `npm run cap:sync` Android: foreground/background/resume, camera, location unavailable, offline capture and restore.
- [ ] In-app notices and auto-refresh on foreground/reconnect/resume without push. Background push stays outside v1, and the existing native registration is untouched.
- [ ] Legacy quarantine and account switching with real pre-existing queue data.
- [ ] Check the integration cut-off Ciaran recorded at C0.

## Known limitations

- A capture taken while no driver is signed in records `actorId: null`. It is held but not sent and not quarantined. The authenticated layout should make this unreachable, but nothing enforces it.
- The OfflineBanner's "items removed" notice can no longer appear, because nothing is dropped any more. It is left in place to keep the change small.
- Quarantining legacy drafts on upgrade means a driver who is mid-phase when they install this build re-captures that step. The old draft is kept on `/evidence`. This is what the contract asks for.

## Tests still owed

- **T2:** `components/trip/__tests__/DriverSubstitutionFlow.test.tsx` and `lib/hooks/__tests__/useSubstitutionCapture.test.ts`, covering every case in the T2 plan list.
- **T3:**
  - `lib/offline/*` tests for `live-write-conflict`, `queue-storage` migration, `retained-drafts`, `late-evidence-sync` and `substitution-store`.
  - Extended `useOfflineQueue` tests: generic 409 retained; `EVIDENCE_ALREADY_RECORDED` clears only its own item; `TRIP_HANDED_OVER` keeps the bytes; A→B→A; two accounts; late upload with a lost response; IndexedDB write failure.

## Existing tests to update

These existing tests encode behaviour that FP-83 deliberately changes, so they are expected to fail until they are updated:
- `lib/hooks/__tests__/useOfflineQueue.test.ts`: a 409 was a silent drop and other 4xx were dropped and counted. Both are now retained. Entries need an `actorId` matching the signed-in driver to send.
- `lib/offline/legacy-exception-migration.test.ts`: migrated legacy reports are now `quarantined`, not `pending`.
- `lib/offline/exception-sync.test.ts`: the `rejected` outcome now carries `attention`, and a report from another account is `not-yours`.
- `components/layout/__tests__/OfflineBanner.test.tsx`: Dismiss/Delete is replaced by Review and Try again.
- Any test that seeds `fp_draft_*` with raw JSON: drafts are now stored as `{ v: 2, actorId, custodySequence, draft }`. Raw drafts are treated as legacy and quarantined.
