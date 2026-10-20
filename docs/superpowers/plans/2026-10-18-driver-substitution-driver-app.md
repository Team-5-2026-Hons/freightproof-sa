# Driver Substitution Driver App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Repository restrictions override skill examples: do not commit, push, merge, rebase, switch branches, discard changes or read secrets.

**Goal:** Let both drivers discover an arranged substitution, record their own handover evidence, and move safely between current work and participation history.

**Architecture:** Consume Ciaran's shared API contract and fixtures. Keep pending substitution assignments separate from the current working trip, use server-derived access and custody sequence, and retain offline work until the server explicitly acknowledges it. The app never changes ownership optimistically.

**Tech Stack:** Existing driver Next.js App Router, React, TypeScript, Capacitor, existing offline storage and Vitest. All pages use `"use client"`; preserve static export.

**Spec:** [Team specification](../specs/2026-10-18-driver-substitution-team-decision.md). **Contract:** [Driver substitution API v1](../../contracts/driver-substitution-v1.md). **Backend dependencies:** [Ciaran's implementation plan](2026-10-18-driver-substitution.md).

## Handoff for Tim

The team approved FP-83. Tim owns changes inside `frontend/driver-pwa`; Ciaran owns backend, dispatcher, shared contracts/mocks and integration. You are not alone in the codebase: preserve others' changes and request shared contract edits from Ciaran rather than editing his files.

You can start T1 and the fixture-driven parts of T2 after C0 publishes shared types and fixtures. Connect actual endpoints after C6. Do not wait for a complete backend to build the screens, and do not invent a second mock schema that later has to be translated.

Confirmed policies: any same-organisation dispatcher may attest missing confirmation; only an admin may attest unavailable identity verification. The app uses an existing verified driver record, not a fresh external identity session. In-app notices and automatic refresh are required. Background push is outside v1 acceptance; native permission/registration alone is not evidence of server delivery. No new provider or push work is required for this handoff. The backend currently has no identified production driver-verification writer: render truthful PENDING/admin-attested status unless Ciaran supplies a genuine verified-record source, and never simulate a production verification pass.

## Global Constraints

- Modify only `frontend/driver-pwa`. Shared types, fixture changes and backend fixes go to Ciaran. No dependency additions or upgrades within this task.
- Use the existing typed API transport and account/session handling. Do not sign a driver out because a trip was handed over; that is different from a superseded login session.
- Current work, incoming collection assignments and former participation are distinct states. Trip status remains the actual trip status; a former driver can have history on an active trip.
- Preserve camera captures, original capturer, capture time, request ID and custody sequence through retries. Never copy the other driver's photos into the caller's independent confirmation.
- A notification being delivered or marked read is not a handover confirmation. A local swipe does not prove the server changed custody.
- Keep existing cargo visibility restrictions. Show no new identity number, licence number or unrestricted post-handover GPS trail.

## Review Focus

1. No active trip: the replacement still receives a pending collection assignment and notices. Test in T1.
2. A pinned old trip still exists: clear it as working context based on the server's ownership response and direct the driver to history. Test in T1.
3. A 409 is an ownership conflict, not a duplicate: retain evidence and explain the next action. Test in T3.
4. A → B → A: an old A capture remains in its original custody sequence; it cannot be submitted as A's later work. Test in T3.
5. Confirmation is saved but transfer is blocked or the response is lost: refetch with the same key; display truthful pending/completed state. Test in T2.

## T1 Show assignments notices and participation history

**Depends on:** C0. **Visible result:** incoming/outgoing/cancelled/former states work from Ciaran's fixtures even with no current trip.

**Files:** create `lib/api/driver-substitutions.ts`, `lib/hooks/useDriverSubstitutions.ts`, `components/trip/DriverSubstitutionCard.tsx`, `DriverParticipationHistory.tsx` and their tests. Modify `lib/context/TripContext.tsx`, `lib/hooks/useTripAutoRefresh.ts`, `lib/types/driver-trip.ts`, `lib/utils/trip-filters.ts`, `lib/hooks/useGroupedTrips.ts`, `components/trip/TripDetailView.tsx`, `app/(app)/trips/page.tsx` and existing detail clients under `app/(app)/trips/[id]/` and `trips/detail/` as needed. Use the existing authenticated app layout/provider boundary to start notice refresh.

**Interfaces:** import contract types/fixtures from `@shared/lib/types/driver-substitution` and `@shared/lib/mocks/driver-substitutions`. Expose `fetchDriverSubstitutions()`, `fetchSubstitutionNotices()`, `markSubstitutionNoticeRead(id)`, `fetchDriverParticipation(tripId)` through the existing transport. New driver list fields are defined by Ciaran's backend/shared contract.

- [ ] Write failing tests for incoming assignment with `fetchMyActiveTrip() === null`, separate current work plus pending incoming assignment, both driver roles and cancellation/replacement notices.
- [ ] Write tests grouping former participation into Past while `trip.status === 'active'`; keep genuine active/current and created/upcoming grouping unchanged.
- [ ] Add a separately loaded substitution/notice resource independent of TripContext's current-trip polling. Refresh on app foreground, reconnect and a bounded visible-app interval using the existing polling constant. Avoid duplicate timers and retry storms while offline.
- [ ] Display a persistent notice and collection card: trip reference, named exchange point/map position, expected time, instructions, counterpart contact, truck/trailer registrations, remaining stops and relevant current findings. Clearly label the observation time of any separately displayed latest vehicle location.
- [ ] Handle `TRIP_HANDED_OVER`: clear the working pin and active actions, refresh current assignment, and offer the participation view. Do not remove local evidence or mark the whole trip closed. Do not keep a former trip active just because a historical read succeeds.
- [ ] Route the outgoing driver's completion notice to participation history. Cancelled/replaced notices can open the authorised arrangement snapshot but must not fetch subsequent live trip context.
- [ ] Add typed API errors with a preserved `code` and optional current version/evidence ID. Continue parsing legacy string/422 errors and preserve existing token refresh and single-device behaviour.
- [ ] Run `cd frontend/driver-pwa && npm test -- lib/context/__tests__/TripContext.autorefresh.test.tsx lib/utils/__tests__/trip-filters.test.ts` plus the new hook/component tests; run `npm run type-check`. Expected: all relevant tests pass with the C0 fixtures.

**Fence:** no backend ownership decisions, new routing engine or push provider. Do not expose a former driver's history by reusing unrestricted current trip detail.

## T2 Capture handover and takeover separately

**Depends on:** C0 for fixtures; C4/C6 for real capture endpoints. **Visible result:** both drivers can record their own checks and see pending versus server-completed transfer.

**Files:** create `components/trip/DriverSubstitutionFlow.tsx`, `lib/hooks/useSubstitutionCapture.ts` and matching tests. Integrate the flow into the existing trip detail surface. If a separate page is needed, use `app/(app)/trips/substitution/page.tsx` with query-string IDs, not a new unenumerated dynamic route incompatible with static export. Extend `lib/api/driver-substitutions.ts` and reuse existing camera, location, evidence upload and seal UI capabilities.

**Interfaces:** API functions `uploadSubstitutionArtifact(tripId, requestId, role, upload)`, `confirmDriverSubstitution(tripId, requestId, body)` return the shared contract types. Pending incoming upload uses the dedicated request endpoint; ordinary `/artifacts` permission is not assumed. Build bodies from Ciaran's schema, not local guessed fields.

- [ ] Write failing outgoing/incoming capture tests: correct vehicles, separate photos, applicable seal checks, unavailable location, identity PENDING/FAILED, incoming inactive, missing/expired licence, one existing confirmation and final confirmation. Test a saved capture returning 200/pending separately from an unsaved 409 version conflict. Include a per-vehicle not-applicable seal reason and schema-valid normalised seal numbers.
- [ ] Capture the confirmed vehicle set, seal state/number/photo, discrepancy note, actual capture time and location availability on the authenticated driver's own device. Use `SubstitutionSealCondition`, including `not_applicable_reason` per empty-leg vehicle, rather than changing ordinary-phase enums. Follow the contract's number/photo requirements; do not send one top-level note as every vehicle's reason. Render identity as the server's recorded status; do not present a fresh biometric check.
- [ ] Persist the draft and original stable request ID before upload/submit. A transport retry reuses the same key; a materially revised declaration creates a new intentional action. Never overwrite the captured custody sequence with whichever sequence is current at retry time.
- [ ] Last confirmation may return a completed transfer; refetch authoritative state before showing the replacement's ordinary trip controls. A pending response with `completion_blocked_by` shows the saved confirmation and truthful outstanding requirement. Use the shared blocker enum and endpoint/status/code matrix: a saved confirmation is 200 even when completion is blocked; do not retry it as if it were lost. An exact retry returns its original saved result; a dispatcher can trigger a new completion check after eligibility is resolved without replacing driver captures. Incoming licence eligibility is rechecked on the actual SAST completion date; admin identity attestation cannot bypass an expired/missing licence. The outgoing driver gets a completed handover summary and history access.
- [ ] If the arrangement version changed, preserve the local capture and refetch. If cancelled/replaced, show why the original submission cannot complete and retain the material for review. Do not silently reuse it against the new request ID.
- [ ] Render already-confirmed evidence read-only. The counterpart's evidence may be compared where the contract permits but cannot be submitted as the caller's capture.
- [ ] Run `npm test -- components/trip/__tests__/DriverSubstitutionFlow.test.tsx lib/hooks/__tests__/useSubstitutionCapture.test.ts` and the affected trip-detail tests; run type-check and `npm run build` to prove static export still works.

**Fence:** no optimistic custody switch, no new trip phase, no repeated activation/loading, no dispatcher override controls in the driver app.

## T3 Make drafts and offline queues custody aware

**Depends on:** C0 and T1; C4/C6 for live late-evidence verification. **Visible result:** a stale driver's queued capture becomes an explicit retained item or late-evidence receipt, never another driver's work.

**Files:** modify `lib/hooks/useOfflineQueue.ts`, `lib/hooks/__tests__/useOfflineQueue.test.ts`, `lib/offline/{exception-sync,exception-store}.ts` and tests, `lib/api/{client,artifacts,phases,checkpoints,locations,exceptions,handover}.ts` where those wrappers exist, `lib/types/evidence-draft.ts` and phase capture/submit consumers. Create `lib/offline/substitution-store.ts`, `late-evidence-sync.ts` and their tests, following the existing IndexedDB patterns. Use a shared late-evidence status type from Ciaran rather than a new incompatible status vocabulary.

**Interfaces:** `submitLateEvidence(tripId, body) -> Promise<LateEvidenceRead>` and `uploadLateEvidenceArtifact(tripId, custodySequence, upload)`. The stored envelope contains original actor account, trip, custody sequence, capture time, typed evidence kind/body, local photo references and stable request ID. Names and persistence details are local implementation choices; the wire body is fixed by the contract.

- [ ] Write failing tests proving a generic 409 is retained, a proven `EVIDENCE_ALREADY_RECORDED` clears only the matching item, and `TRIP_HANDED_OVER` produces needs-attention with capture bytes intact.
- [ ] Add tests for A→B→A, two signed-in accounts using the same device at different times, late artifact upload followed by lost-response retry, and a local storage/IndexedDB write failure. Never replay A's local data using B's token.
- [ ] Add a versioned migration for pre-existing `fp_offline_queue` and evidence drafts. Test legacy entries with no actor, actor without sequence, malformed metadata, migration interrupted by storage failure, and migration rerun. Unknown-actor entries go to a local quarantine with bytes and original metadata retained, no automatic upload and no reassignment to the current login or trip owner. Show an explicit review/export or deliberate discard action without claiming the signed-in user captured it; never call late-evidence endpoints under a guessed actor. Trusted actor metadata may preserve existing no-substitution compatibility, but missing sequence after a transfer remains needs-attention. Do not clear the old storage record until its migrated/quarantined copy is durably saved.
- [ ] Stamp `custody_sequence` at capture time in every new driver live-write payload, including phase, checkpoint, location, exception, artifact and receiver-handover initiation where applicable. Honour `CUSTODY_CONTEXT_CHANGED` and `CUSTODY_CONTEXT_REQUIRED` as retained context conflicts, not duplicates. Legacy entries without a sequence cannot be relabelled after a substitution.
- [ ] Remove the assumption that every 409 means an earlier request landed. Preserve unrecognised terminal conflicts with an actionable reason; keep existing network/429 retry behaviour. No need-attention dismiss action may silently erase unsent evidence; explicit discard needs a clear user action and local warning.
- [ ] Offer Send as late evidence for an authorised participant, using the dedicated artifact and payload endpoints. Clear local bytes only after an explicit server receipt or actor-bound duplicate acknowledgement. Dispatcher acknowledgement is review, not permission to complete an old phase.
- [ ] Keep offline handover confirmations pending until accepted online. Never show a completed custody change from a local enqueue. Protect unsent captures when the current-trip selection changes or the app resumes into a new assignment.
- [ ] Run the queue, exception-store/sync and new offline tests plus type-check. Exercise offline capture → server transfer → reconnect in the actual app with Ciaran; inspect both preserved local state and server actor/time fields.

**Fence:** no retrospective phase advancement and no silent evidence deletion. This task must cover existing queue formats, not just new handover captures. Unknown actor is a distinct problem from missing sequence; neither may be inferred from current ownership.

## T4 Integrate validate and report

**Depends on:** C6, C7 and T1–T3. **Visible result:** the real combined two-driver flow works in the supported client.

**Files:** driver app tests and integration fixes only; report contract changes to Ciaran. Keep a short validation record in the implementation handoff rather than changing the feature spec.

- [ ] Compare actual OpenAPI responses and multipart upload behaviour against the shared fixtures with Ciaran. Check current, pending, former and unrelated accounts and all conflict codes.
- [ ] Demonstrate ordinary handover, missing-confirmation completion, unavailable/failed identity, replaced arrangement, driver with no current trip, phase already partly captured, app restart and two successive transfers.
- [ ] Verify a current driver cannot submit stale work from an earlier custody sequence after returning to the same trip. Verify former history excludes later live locations and unrestricted subsequent evidence.
- [ ] Run `npm test`, `npm run type-check`, `npm run lint`, `npm run build`. Do not count skipped or mocked-only flow tests as proof that the real endpoints work.
- [ ] Build/sync the supported Capacitor Android target using the existing `npm run cap:sync` process. Check foreground/background/resume, camera, location unavailable, offline capture and restoration. Do not alter the app's export configuration to make a build pass.
- [ ] Verify in-app notices and automatic refresh on foreground, reconnect and resume without relying on push. Record background push as outside v1; leave existing native registration intact. Any later push addition needs a demonstrated server/device path and separate scoped follow-up.
- [ ] Demonstrate legacy unknown-actor quarantine and account switching with pre-existing queue data; no item may be reassigned or silently deleted. Check the actual integration cut-off recorded by Ciaran at C0 before declaring the driver track ready.
- [ ] Report changed files, exact commands/results, browser/native client tested, outstanding limitations and the final contract revision to Ciaran. Ciaran then completes C8 combined release verification.

## First session prompt

“Read CLAUDE.md, this driver-app plan and the driver substitution v1 contract. You own only frontend/driver-pwa. Start with T1 after verifying Ciaran's shared types and fixtures exist. Use those fixtures to implement notices, pending incoming/outgoing assignments and former participation history. Do not edit backend, dispatcher, shared types or migrations; request contract changes from Ciaran. Do not read secrets or run Git write operations. Finish with the focused tests and type-check results.”
