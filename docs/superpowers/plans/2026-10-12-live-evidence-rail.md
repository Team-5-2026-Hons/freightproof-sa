# Live Evidence Rail (FP-287 + FP-288) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **lean plan**: it fixes decisions, interfaces and test cases; the implementer writes the code. Claude never commits — every "commit" step means: stage the named files, Ciaran reviews and commits.

**Revision 2 (2026-10-12):** amended after an external review. Changes: receiver provenance (D8, D8b), active/cancelled context for the row builder (D12, D23), no "replaced" inferred from timestamps (D24), rows survive missing artifact metadata (D25), the replay/override contract corrected to match `gate.py` (D26), identical-content deduplication wording (D5), real concurrency and rollback tests, a backend review checkpoint (Task 5), and the panel-photo removal moved after the preview (Tasks 9–11).

**Revision 3 (2026-10-12):** the server "received" time is defined and stamped explicitly after the Storage upload (D27), because the column's `now()` default is the transaction's start; tests cover an upload paused across cancellation and override. Lint commands use the repository's `npm run lint`.

**Goal:** Every photo a driver captures, and the receiver's confirmation, appears in the right phase card on the dispatcher's trip timeline as it lands, and every phase reads as a short, honest record of what was captured, what was submitted, what was raised and what was anchored.

**Architecture:** Two nullable columns on `evidence_artifacts` (`phase_event_id`, `evidence_role`) record which phase and which evidence role a capture was taken for. The driver app sends them on upload; the receiver path sets them server-side from the handover token. Completion keeps the phase's artifact columns as the only record of what was *submitted*, rejects a cited artifact whose attribution contradicts its field, and rejects a driver's own upload as the receiver confirmation. One INFO realtime kind (`evidence_uploaded`) refreshes only the artifacts resource. The dispatcher assembles each phase's rows client-side with one pure function (`buildPhaseActs`) over records it already fetches, and renders them inside the existing `PhaseTimelineItem` slots. No child ledger, no anchor-payload change.

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async, Pydantic v2, Alembic (hand-written), pytest; Next.js 15 / React 19 / TypeScript, Tailwind, vitest + Testing Library.

**Spec:** this plan's Design section, which revises [2026-09-05 live phase timeline handoff §3 "Path A"](../../design-notes/2026-09-05-live-phase-timeline-handoff.md) and [2026-09-23 Arrival note §4.6 / S6](../../design-notes/2026-09-23-arrival-phase-and-live-journey.md). Where they disagree, this plan wins and says why (Decisions table).

---

## Global Constraints

Every task implicitly includes these. Sources in brackets.

- Python 3.13, SQLAlchemy 2.0 `Mapped`/`mapped_column`, Pydantic v2, every endpoint `async def`, DB through `get_db()` [CLAUDE.md].
- **Orchestration never commits.** It `flush()`es; routes and `get_db` own `commit`/`rollback` [audit §5, stage 3a]. Use `async with db.begin_nested()` for an insert that may hit a unique violation (precedent: `evidence/action_location.py:521`).
- Domain errors live in `app/core/exceptions.py` and are mapped to HTTP status in the route, never raised as `HTTPException` from orchestration [audit §5, handover stage 3a].
- New functions: ≤ 5 parameters (ruff `PLR0913`), cyclomatic complexity ≤ 10 (`C901`), ≤ 50 statements (`PLR0915`), ≤ 100 lines (`scripts/check_structure.py`). Never add a `ruff.toml` per-file ignore or an `.importlinter` ignore to make new code pass [ruff.toml, .importlinter headers].
- `orchestration/` sub-package `__init__.py` files stay empty; modules are named for their job, no `_service` suffix [audit §5 rule 1, §5.6].
- Stored and hashed names are frozen: role values reuse the existing column/payload stems (`seal_photo` ↔ `seal_photo_artifact_id` ↔ `seal_photo_sha256`) [audit §5.6 rule 4].
- **No anchor payload change.** `payloads.py` and the B3 golden hashes stay untouched [scope].
- **The resolved-phase replay shortcut in `phases/gate.py:32` is preserved exactly** (D26). Nothing in this plan adds a check before it.
- Migration: hand-written, file `backend/migrations/versions/2026_10_12_ciaran_artifact_attribution.py` (use the actual date written), revision id `ciaran_artifact_attribution` (< 32 chars). Before writing it: `git fetch origin` and check `dev` for unmerged migrations; `down_revision` = the single current head (today `tim_add_audit_packs`). Never `alembic revision --autogenerate`, never `alembic upgrade` from the feature branch; Ciaran runs every DB command [CLAUDE.md, memory].
- Tests build the schema with `Base.metadata.create_all`, so **every constraint and index must also be declared on the model**, not only in the migration.
- POPIA: realtime events stay ids-only (`TripEvent`); no coordinates or names in any new payload, log line, row label or event. The receiver's name and ID number exist only inside the attestation image, as today.
- TypeScript: no `any`, explicit prop interfaces, typed API client (never raw `fetch` in components), `frontend/shared/` has no third-party imports, every `driver-pwa` page stays `"use client"` [CLAUDE.md, audit §7].
- Run the backend suite with `backend/.venv/bin/pytest`, in the foreground, alone (a concurrent run shares the test DB and produces false failures) [memory].
- Baselines to re-measure at the start of Task 1 and compare at Task 12: backend full suite (2,859 passed / 4 skipped at the last audit), dispatcher vitest, driver-pwa vitest, 17 import-linter contracts.
- Out of scope and kept separate: frontend lint ratchets, CLAUDE.md corrections, the child-event ledger, anchor payload changes.

## Review Focus

The five conditions most likely to bite a real user that no single task's happy-path tests would exercise. Each has a pinned test in the task named.

1. **A pre-update driver app during rollout.** It uploads without attribution. The active phase must not claim the photo is missing; "Expected: seal photo" (an expectation) is honest, "No seal photo yet" would be false. Pinned in Task 8 (`expected rows never assert absence`).
2. **Device clock skew.** `captured_at` comes from the phone and can be later than the server's `created_at`. Rows must keep a stable order, label both times with their clock, and never use the phone clock to decide which photo is current. Pinned in Task 8 (`device clock ahead of server`).
3. **Reconnect after a dropped stream.** The new kind filters must not stop the reconnect refetch, which is the only recovery for missed events. Pinned in Task 7 (`reconnect refreshes every filtered resource`).
4. **Many uploads for one role.** Six seal photos in one phase must not turn the card into a wall. Pinned in Task 9 (`groups several uploads for one role`).
5. **Artifacts fetch failed or Storage declined to sign.** A submitted photo must still appear as recorded-but-unavailable, never disappear. Pinned in Task 8 (builder) and Task 9 (through `TripTimeline`).

---

## Design

### The receiver handover, as built (verified 2026-10-12)

1. The driver's confirmation step shows a rotating QR (`driver-pwa/.../confirmation/ReceiverHandover.tsx`). The driver no longer draws or uploads any signature.
2. The receiver scans it and lands on the receiver web app (`frontend/receiver`, page `/h/[token]`): no account, no install.
3. The receiver types their name and SA ID number, then chooses at a consent gate: an identity check with Didit (document and face), a selfie (no document; not uploaded yet, handed to Tim), or decline. The outcome is stored in `receiver_identity_verifications` (status, tier, reason).
4. The receiver swipes to confirm. Their browser renders an **attestation image** (`shared/lib/utils/render-attestation.ts`): trip reference, typed name and ID number, time and position. It is not a hand-drawn signature. The route redeems the token, then stores the image as an evidence artifact (`create_receiver_artifact`, no driver id) and writes `handover_confirmations` (position, accuracy, IP, user agent, `confirmed_at`) **in one transaction** (`endpoints/handover.py:281-310`), and links any verification to it.
5. The driver app reads the confirmation and submits the image's artifact id as `pod_signature_artifact_id` when the driver completes the confirmation phase.

So "the signature" in code is the attestation image, one part of the handover. The Didit result is a separate record that this plan does not display (F3). The anchor commits only the image's hash (`pod_signature_sha256`).

### What existing fields already support (verified 2026-10-12, `Ciaran`)

| Need | Existing support | Gap |
|---|---|---|
| Which photo a completed phase **submitted** | `phase_events.{linehaul,seal,waybill,pod}_photo_artifact_id`, `pod_signature_artifact_id` (`db/models/phases.py:109-143`), written by each `advance_*` | None after completion. Before completion there is no link at all |
| When a photo was taken / received | `evidence_artifacts.captured_at` (client clock for driver uploads; server clock for the receiver image, `handover/service.py:274`) and `created_at` | `created_at` defaults to Postgres `now()` (`db/models/evidence.py:44`), which is the **transaction start**: in `create_artifact` that is the trip lookup, before the Storage upload, so a slow upload records an earlier time than the row's real creation. Fixed by D27 using the same column |
| Telling a retry from a retake | `evidence_artifacts.file_hash` (SHA-256 of the bytes, `storage/supabase_storage.py:55`). A fallback re-upload sends the same bytes with the same draft capture time; a retake sends different bytes | No scope: without phase and role, equal hashes cannot be grouped |
| Receiver confirmation's phase | `handover_confirmations.phase_event_id` (unique per phase) + `signature_artifact_id`; `handover_capability_tokens.phase_event_id` | Not reachable from the artifact; not checked at completion: `advance_confirmation.py:46-52` accepts any same-trip artifact as `pod_signature_artifact_id` (source inspection, not reproduced) |
| Who produced an artifact | `captured_by_driver_id` is set by every driver upload and left null by `create_receiver_artifact` (its docstring; asserted in `test_phase_anchoring.py:435`) | Null alone does not prove a receiver (seed scripts also write null) |
| Exception photos, checkpoint photos | `exceptions.supporting_artifact_id`, `checkpoints.selfie_/cargo_photo_artifact_id` | None. These links stay on their owning records (D6) |
| Phase-level location check | `phase_events.action_location_assessment`, `pulsit_geofence_confirmed`, horse/trailer fixes; shown by `LocationEvidenceSummary` | None. Evaluated at completion; must not be painted onto earlier photos (D9) |
| Exception review | `review_status`, `review_outcome`, `reviewed_by_user_id`, `reviewed_at`, `review_note`, `contact_method` (`db/models/transit.py:250-270`) | None for display. One latest review, not a history |
| Anchor time | `blockchain_receipts.hedera_consensus_timestamp`; `phase_events.anchor_status` | None |
| Which phase is active; when a trip was cancelled | Active is derived from the whole plan (`currentTripPhase`); `cancel_trip` leaves phase rows untouched and sets `trip.closed_at` (`trips/administration.py:58`) | Neither is visible from one phase row, so the builder must be given both (D23) |
| Warehouse scan session | Per-parcel `pp_scan_out_at`/`pp_scan_in_at` written by `consignments/scans.py:301-305`; `phase.blocked_on` | Session closure time is not stored, and the feed is mock-only (`integrations/scan_feed.py:205`). No scan row is built (D11) |

Rejected alternative to new columns: inferring a photo's phase from timing. The capture clock is the phone's, offline uploads arrive late, and a retake after navigating back breaks it. Inferred attribution would be fabricated evidence.

So the plan adds **two columns and nothing else**: `phase_event_id` and `evidence_role`. No client capture id, no `selected` flag, no `superseded_by`.

### Evidence roles

| `evidence_role` | Valid on phase | Phase column it is submitted in | Producer | Anchored hash key (v2) |
|---|---|---|---|---|
| `linehaul_photo` | loading | `linehaul_photo_artifact_id` | driver | `linehaul_photo_sha256` |
| `seal_photo` | departure, arrival | `seal_photo_artifact_id` | driver | `seal_photo_sha256` |
| `waybill_photo` | departure | `waybill_photo_artifact_id` | driver (legacy queued entries only) | `waybill_photo_sha256` |
| `pod_photo` | confirmation | `pod_photo_artifact_id` | driver | `pod_photo_sha256` |
| `pod_signature` | confirmation | `pod_signature_artifact_id` | receiver page, set by the server from the token | `pod_signature_sha256` |

`gate_photo_artifact_id` has no writer and gets no role.

### Attribution and replay contract

| Situation | Behaviour | Existing protection reused |
|---|---|---|
| Driver upload with both fields | Phase must belong to the trip (else 404, as for a foreign trip); role must be valid for that phase type and driver-producible (else 422). **Phase state is not checked** (D4) | `create_artifact` driver ownership check (`evidence/artifacts.py:55`) |
| Exactly one of the two fields | 422 at the route; DB CHECK backs it | — |
| No fields (older app, checkpoint, exception photo) | Stored unattributed, exactly as today | — |
| Every new row written through `_persist_artifact` | `created_at` is stamped explicitly with the API server's `datetime.now(UTC)` **after** the Storage upload returns, when the row is constructed (D27). It means "the server finished storing the file and created the record", not commit time. This is the same clock that stamps `completed_at` (`phases/completion.py:40`, `override.py:79`) and `trip.closed_at` (`trips/administration.py:59`), so the after-closure comparisons compare like with like | — |
| Identical bytes, same phase and role (fallback re-upload, queue replay, stale early upload) | **Identical-content deduplication**: return the existing row unchanged, including its original `created_at`; no new Storage object when the lookup hits; no event. The incoming metadata is never written over the original. If the incoming `captured_at` differs, log both times at WARNING with the artifact id (no coordinates). This is not proof the two uploads were one capture; in today's client the draft sets one capture time with the photo, so a mismatch points to a client defect | Partial unique index (new); `integrity.is_unique_violation` |
| Two such uploads race | One insert wins on the unique index; the loser rolls back its savepoint and returns the winner; the loser's Storage object is orphaned and logged at WARNING | Same |
| Different bytes, same phase and role (retake) | New row. Both kept; the phase column decides which was submitted | — |
| Early upload resolves after a retake or after navigating away | Driver hook resolves `null` for any request that is no longer the latest for its role, or whose step unmounted; the draft keeps the newer photo | `useArtifactUpload` unmount guard (`useArtifactUpload.ts:31-36`), extended |
| Upload lands after the phase completed / was overridden / trip cancelled | Accepted and attributed; shown as received after closure, never as submitted | Replay safety: rejecting would make a queued phase entry fail on its upload step |
| Upload attributed to a later, not-yet-active phase | Accepted (structural check passes); not shown until that phase becomes active or resolved | — |
| Completion of an **open** phase cites an attributed artifact | Its `phase_event_id` must equal the phase and its `evidence_role` the field's role, else 422 before any evidence is written | `_assert_artifacts_belong_to_trip` ownership query (`phases/artifacts.py:14`), extended |
| Completion of an open phase cites an unattributed artifact | Accepted (older builds, queued entries, signatures confirmed before deploy), except D8b | Same |
| Completion of an open confirmation cites, as `pod_signature`, an artifact with a driver id | 422 (D8b): a driver's own upload is never the receiver's confirmation | `create_receiver_artifact` never sets a driver id |
| **Any** completion request for a resolved phase (completed, exception, overridden) | Returns the recorded trip with 200 **before any check**, whatever the idempotency key; nothing written, no anchor queued. The driver app reads the returned `phaseStatus` to tell a replay from fresh work (`lib/api/phases.ts` `SubmitPhaseResult`). Note the offline queue mints a new key per queued entry (`useOfflineQueue.ts:344`), so this status check, not key equality, is what prevents double completion | `_gate_and_load` (`phases/gate.py:32`) |
| Completion of a pending phase on a cancelled or closed trip | 409 (`PhaseSequenceError`, `gate.py:60`) | Same |
| Override or cancel races an upload | The upload takes no lock and checks no state, so it cannot deadlock or fail; the dispatcher shows it as received after closure | Trip lock order in `loaders._lock_trip` |
| Receiver confirmation | `create_receiver_artifact` sets `phase_event_id = token.phase_event_id`, `evidence_role = pod_signature`, inside the transaction that writes `handover_confirmations`; the driver endpoint can never claim `pod_signature` | Redeemed capability token; one confirmation per phase |

Residual, stated: an unattributed artifact with **no** driver id (a receiver image from before deploy, or a seed row) can still be cited as `pod_signature`; the dispatcher labels it neutrally (D8). Requiring attribution is F2.

### Evidence-source matrix (rows the rail renders)

| Row | Exact wording | Source and producer | Phase link before → after completion | Clocks shown | Stored / derived | Covered by today's anchor? |
|---|---|---|---|---|---|---|
| Loading photo | "Linehaul sheet photographed" | `evidence_artifacts`, driver | attribution → `linehaul_photo_artifact_id` | "Taken" (device), "Received" (server) when ≥ 2 min apart; "Time unavailable" when metadata did not load | stored | Hash of the **submitted** copy only; no times |
| Departure seal photo | "Seal photographed" — never "seal applied": no act of applying is recorded | driver | attribution → `seal_photo_artifact_id` | same | stored | Hash + seal number |
| Arrival inspection | "Seal photographed on arrival"; the completion row adds "Seal found {intact / damaged / missing}" | driver; `seal_condition` on the phase row | attribution → arrival `seal_photo_artifact_id` | same | stored | Hash + seal number + condition |
| POD photo | "Proof-of-delivery photo taken" | driver | attribution → `pod_photo_artifact_id` | same | stored | Hash |
| Receiver confirmation | Attributed `pod_signature` for this phase: "Receiver confirmed delivery". Anything else in that field: "Submitted as receiver confirmation". Identity-check outcome is **not** shown (F3) | attestation image from the receiver page | attribution (server, from token) → `pod_signature_artifact_id` | "Confirmed {time} (server time)" | stored | Image hash only; receiver position, verification and `confirmed_at` are not committed |
| Phase completion | "Driver confirmed {phase}" · "… — exception recorded" · "Closed by dispatcher override" | `phase_events` | the row itself | "Confirmed {driver_captured_at} on device · recorded {completed_at}" (second part only when ≥ 2 min apart) | stored | Phase identity; **no times**. Hedera consensus time proves the committed hashes existed no later than that instant |
| Exception raised | "{Type} raised" + severity chip | `exceptions` (driver or system) | `exceptions.phase_event_id` | existing `exceptionEventTime` rule | stored | No (FP-290) |
| Exception review | "Needs review" · "Recorded" · "Reviewed · {outcome} · {contact method}" | `exceptions.review_*`, `contact_method` | via the exception | `reviewed_at` (server) | stored; latest review only | No (FP-290) |
| Expected evidence (active phase only, trip not cancelled) | "Expected: {role noun}" · "Waiting for the driver to confirm {phase}" · "Waiting for the warehouse scan to finish" | `EVIDENCE_ROLES` + `phase.blocked_on` | — | none | derived | n/a |
| Anchor strip | "Anchored {consensus time}" · "Anchoring pending" · "Anchor failed — receipt still owed" | `phase.anchor_status`, receipt | phase | Hedera consensus | stored | It is the commitment |
| Location check | unchanged `LocationEvidenceSummary` chip in the card summary | `action_location_assessment` | phase | as today | stored | No (off-chain by design) |

**Photo states** (D24), never inferred from capture order:

| When | State | Wording |
|---|---|---|
| Active phase, trip not cancelled | `uploaded` | "Uploaded" (with "{n} photos uploaded" above the group when a role has more than one) |
| Phase resolved, its column cites this artifact | `submitted` | "Submitted at completion" |
| Phase resolved, not cited, `created_at` ≤ `completed_at` | `not_submitted` | "Not submitted" |
| Phase resolved, not cited, `created_at` > `completed_at` | `after_close` | "Received after the phase closed" |
| Trip cancelled with this phase unresolved | `trip_cancelled` | "Not submitted — trip cancelled" (or "Received after the trip was cancelled" when `created_at` > `trip.closed_at`) |

**"Received" means** `created_at`: the server time at which the file had been stored and the record created (D27). It is not commit time, so a row created in the instant between a cancellation being stamped and that cancellation committing can still read "after". Rows written before this change carry their transaction's start time and may read up to one upload duration early.

"Uploaded" vs "submitted": a row is **Submitted at completion** only when the phase column points at it. "Recorded" vs "anchored": a row is recorded when it exists in Postgres; only the phase's submitted hashes are anchored, and only once `anchor_status = anchored`.

### Rail placement and live behaviour

| Phase state | What shows |
|---|---|
| Active (from `currentTripPhase`), trip running, not in_transit, not trip_creation | Rows always visible via `persistentContent`; newly seen rows get a short `motion-safe` highlight; expected rows dashed |
| Resolved (completed / exception / overridden) | One summary line always visible ("4 recorded · 1 exception, 0 unreviewed · Anchored"); rows inside the disclosure, above the detail panel. Late uploads, reviews and anchor receipts update silently: no highlight, no pulse |
| The unresolved phase of a **cancelled** trip that has any attributed upload | Rows always visible (D23), in `trip_cancelled` state; no expected rows, no highlight. The detail panel stays suppressed as today |
| Any other pending phase, or not reached on a cancelled trip with no uploads | Nothing (unchanged) |
| in_transit | `InTransitTimeline`, unchanged |
| trip_creation | `TripCreatedDetail`, unchanged |

Photos move from the four detail panels to their rows only after the preview in Task 10 (Task 11), so each artifact ends up rendered in exactly one place. Verdicts, seal numbers, comparisons, location and override stay in the panels.

### Which resources each event refreshes

| Resource (hook) | `evidence_uploaded` | every other kind | reconnect |
|---|---|---|---|
| Trip detail (`useTripDetail`) | no | yes | yes |
| Trip artifacts (`useTripArtifacts`) | yes | yes | yes |
| Trip manifest (`useManifest`) | no | yes | yes |
| Live trip list (`useTrips`) | no | yes | yes |
| Exceptions queue / detail | no (already kind-filtered) | exception kinds only | yes |
| Trip history | no (already `trip_closed` only) | `trip_closed` | yes |

The classification is a `Record<RealtimeKind, boolean>` so a future kind cannot compile without a decision.

### Decisions

| # | Decision | Why | Revises |
|---|---|---|---|
| D1 | FP-287 and FP-288 are built as one feature on one branch. The child-event ledger and the anchor payload redesign are out | The attribution contract and the rail share one data model; the ledger and payload work are separate products | — |
| D2 | Attribute by a stable **evidence role** named after the existing column and payload stem, not by the UI step slug | Slugs are screen recipes and have already changed (seal inspection moved to Arrival); roles match what completion stores and what the anchor commits | Handoff §3, Arrival note §4.8 (`step_slug`) |
| D3 | Add only `phase_event_id` and `evidence_role`. No client capture id, no "selected" flag, no "superseded by" column | The file hash identifies retries of the same content; the phase column is the selection | — |
| D4 | Upload validation is structural only (trip, phase on trip, role valid for phase type, producer). Phase state is not checked. An upload attributed to a not-yet-active phase is stored but not displayed until that phase is active or resolved | A state check would make queued replays fail and would race override and cancel | Handoff §3 ("validate against the active phase") |
| D5 | **Identical-content deduplication** on (phase, role, file hash) with a partial unique index. The original row is returned and never rewritten; a differing incoming `captured_at` is logged, not stored. Retakes (different bytes) are new rows | Collapses fallback re-uploads and replays without client changes; hash equality is evidence of identical content, not proof of one capture | Handoff §3 (adds deduplication) |
| D6 | Attribution is only for phase-cited evidence. Checkpoint photos and exception photos stay linked from their own records and unattributed | One source of truth per link | — |
| D7 | The phase's artifact column stays the only record of what was submitted. Completion of an open phase rejects contradictory attribution (422) and accepts unattributed artifacts, except D8b | Compatibility with older builds, queued entries and pre-deploy receiver confirmations | — |
| D8 | The server attributes the receiver's attestation image from the handover token, in the same transaction that writes `handover_confirmations`. The dispatcher says "Receiver confirmed delivery" **only** for an artifact attributed `pod_signature` for that phase; anything else submitted in that field reads "Submitted as receiver confirmation" | Only the receiver route can produce that attribution, and it cannot exist without a committed confirmation; a field name alone proves nothing | Review finding 1 |
| D8b | Completion rejects, as `pod_signature`, any artifact that has a driver id (422) | A driver's own upload is never the receiver's confirmation; uses existing data. One existing test cited a driver-made signature (`test_phase_anchoring.py`, `confirmation` case); it now clears the driver id to model a pre-attribution receiver image, accepted at the Task 5 review. Revisit if a driver-side fallback is ever built (none exists: `ReceiverHandover.tsx` replaced the driver signature step) | Review finding 1 |
| D9 | Corroboration stays phase-level and where it is today (summary chip and panel). Photo rows carry no location claim. No witness glyph, separation gauge or evidence-tier badge | A completion-time tracker check cannot vouch for an earlier photo; the chip already states the verdict in words | Witness and Pattern artifact |
| D10 | Rows are assembled client-side by one pure function from resources the page already loads. No new read endpoint, no trip-detail schema change | The data is already on the page; one function is the seam a future ledger would replace | — |
| D11 | No scan-session rows; only the existing "waiting for the warehouse scan" state | Closure time is not stored and the feed is mock-only | Ledger artifact (scan-complete events) |
| D12 | **Active** means the phase `currentTripPhase` returns for the whole plan. Active phase: rows always visible and highlighted live. Resolved phase: a summary line always visible, rows behind the disclosure, updates silent | Current and future phases are both `pending`; density at 13 phases; the summary states what is behind the chevron | Ledger artifact Rule 1, for resolved phases only; review finding 2 |
| D13 | Photos move from the four detail panels into their rows, after the dense, cancelled and unavailable cases have been previewed | One rendering per artifact, without removing the old view before the new one is proven | Review process note |
| D14 | New kind `evidence_uploaded`, INFO, emitted only when a new row is written; it refreshes the artifacts resource only | Uploads must not refetch the trip record, manifest or trip list | Arrival note S6 (adds the per-resource filter) |
| D15 | Waiting rows read "Expected: …" and never claim something is missing | An older build's unattributed upload may exist | — |
| D16 | Every time is labelled by its clock; "Received" shows only when ≥ 2 minutes from "Taken" in either direction | Makes offline capture visible without noise from normal upload latency | — |
| D17 | A phase on another trip → 404; a half pair, invalid role or contradiction → 422 | Matches the existing ownership rule; mistakes within one trip leak nothing | — |
| D18 | Keep the name `_assert_artifacts_belong_to_trip`; change only its parameters | Renames are separate commits (audit §5.6 rule 2) | — |
| D19 | The upload's hash is computed before the Storage upload | A duplicate skips the upload as well as the row | — |
| D20 | No duration in the summary line | No phase start time is recorded | — |
| D21 | The two new `EvidenceArtifact` TS fields are required, and the three fixture files are updated | Avoids another "optional until fixtures catch up" field | — |
| D22 | The new foreign key has no `ON DELETE`; the dev reset clears attribution before deleting | Evidence is never cascaded away; the reset is the only deleter | — |
| D23 | `buildPhaseActs` receives `isActive`, `tripStatus` and `tripClosedAt`. On a cancelled trip the unresolved phase's uploads stay visible in `trip_cancelled` state, with no expected rows and no highlight, even though the detail panel stays suppressed | Cancellation leaves phase rows unchanged and sets only `trip.closed_at`; without this the cancelled scenario disappears | Review finding 2 |
| D24 | Before completion every photo is "Uploaded"; no "replaced" state. After completion: "Submitted", "Not submitted" or "Received after the phase closed" | The server cannot know which photo the driver's draft holds until completion; capture order is not selection | Review finding 3 |
| D25 | Rows for submitted artifacts are built from the phase's columns even when the artifact's metadata did not load: times and provenance may be unknown, and the row uses `EvidencePhoto`'s existing "Recorded artifact unavailable" state | Missing metadata must never erase submitted evidence | Review finding 4 |
| D27 | `_persist_artifact` stamps `created_at = datetime.now(UTC)` after the Storage upload, for every new row (attributed, unattributed and receiver), and that is what "Received" displays. The column's `now()` default stays for other writers (seed scripts). Deduplicated retries keep the original value | `now()` is transaction start, which precedes the upload; one meaning per column; the same API-server clock as `completed_at` and `closed_at`. No new column | Review (rev. 3) |
| D26 | The replay contract is the gate's: any completion request for a resolved phase returns the recorded trip with 200 before any check, whatever the key; a pending phase on a cancelled or closed trip gets 409. Unchanged by this plan | It is how the offline queue drains; changing it would be a separate decision | Review finding 5 (corrects rev. 1) |

---

## File map

| File | Task | Responsibility | Coordination |
|---|---|---|---|
| `backend/app/db/models/enums.py` | 1 | `EvidenceRole` | Shared file (enums): flag in PR |
| `backend/app/core/phase_meta.py` | 1 | `EVIDENCE_ROLES`, `DRIVER_UPLOAD_ROLES` | Owner unknown |
| `frontend/shared/lib/types/evidence.ts` | 1 | `EvidenceRole`, two artifact fields | Shared frontend: flag in PR |
| `frontend/shared/lib/constants/phase-meta.ts` | 1 | role tables mirrored | Shared frontend: flag in PR |
| `backend/app/db/models/evidence.py` | 2 | columns, CHECK, partial unique index | Owner unknown |
| `backend/migrations/versions/2026_10_12_ciaran_artifact_attribution.py` | 2 | migration | Ciaran (Arrival note D6) |
| `backend/scripts/dev_reset_lifecycle.py` | 2 | break the new FK cycle before deletes | Ciaran (Arrival note S5) |
| `backend/app/schemas/evidence.py` | 2 | read fields | API contract (B1 snapshot) |
| `backend/app/orchestration/evidence/attribution.py` (new) | 3 | attribution value + rules | — |
| `backend/app/orchestration/evidence/artifacts.py` | 3 | attributed create, deduplication, event | Owner unknown |
| `backend/app/core/exceptions.py` | 3 | `EvidenceAttributionError` | Shared-ish: flag in PR |
| `backend/app/core/realtime.py` | 3 | `EVIDENCE_UPLOADED` | Shared-ish: flag in PR |
| `backend/app/api/v1/endpoints/artifacts.py` | 3 | two Form fields, error mapping | Owner unknown |
| `backend/.importlinter` | 3 | `attribution` tier in evidence contract | Shared tooling: flag in PR |
| `backend/tests/integration/test_artifact_upload_concurrency.py` (new) | 3 | independent-connection race test | — |
| `backend/app/orchestration/phases/artifacts.py`, `advance_{loading,departure,arrival,confirmation}.py` | 4 | completion check, D8b | Ciaran (Arrival note D6) |
| `backend/app/api/v1/endpoints/phases.py` | 4 | error mapping | Owner unknown |
| `backend/app/orchestration/handover/service.py` | 4 | receiver attribution | **Tim** (receiver flow owner per 9 Oct note; confirm) |
| `frontend/driver-pwa/lib/api/artifacts.ts`, `lib/api/phases.ts`, `lib/hooks/useArtifactUpload.ts`, four step components | 6 | send attribution, stale-result guard | Owner unknown |
| `frontend/dispatcher/lib/realtime/types.ts`, `lib/hooks/useTripResource.ts`, `useTripDetail.ts`, `useTripArtifacts.ts`, `useManifest.ts`, `useTrips.ts` | 7 | refresh narrowing | Owner unknown |
| `frontend/dispatcher/lib/phase/acts.ts` (new) | 8 | `buildPhaseActs`, `summarisePhaseActs` | — |
| `frontend/dispatcher/components/domain/PhaseActs.tsx` (new), `TripTimeline.tsx` | 9 | rail UI, integration | Owner unknown |
| `frontend/dispatcher/app/dev/design/page.tsx`, `components/domain/__fixtures__/phase-acts.ts` (new) | 10 | scenario previews | Owner unknown |
| `frontend/dispatcher/components/domain/{Loading,Departure,Arrival,Confirmation}Detail.tsx` | 11 | remove panel photos | Owner unknown |

---

### Task 1: Evidence role vocabulary, backend and shared, with parity

**Files:**
- Modify: `backend/app/db/models/enums.py` (new `EvidenceRole(str, Enum)`: `LINEHAUL_PHOTO`, `SEAL_PHOTO`, `WAYBILL_PHOTO`, `POD_PHOTO`, `POD_SIGNATURE`; values as in the role table)
- Modify: `backend/app/core/phase_meta.py` (beside `STEP_SLUGS`)
- Modify: `frontend/shared/lib/types/evidence.ts`, `frontend/shared/lib/constants/phase-meta.ts`
- Test: `backend/tests/unit/test_phase_meta_contract.py`

**Interfaces:**
- Produces (Python): `EVIDENCE_ROLES: dict[PhaseType, frozenset[EvidenceRole]]` (entry for every `PhaseType`, empty where none), `DRIVER_UPLOAD_ROLES: frozenset[EvidenceRole]` (all but `POD_SIGNATURE`).
- Produces (TS): `type EvidenceRole = 'linehaul_photo' | 'seal_photo' | 'waybill_photo' | 'pod_photo' | 'pod_signature'`; `EVIDENCE_ROLES: Record<PhaseType, readonly EvidenceRole[]>`; `EVIDENCE_ROLE_FIELD: Record<EvidenceRole, 'linehaul_photo_artifact_id' | 'seal_photo_artifact_id' | 'waybill_photo_artifact_id' | 'pod_photo_artifact_id' | 'pod_signature_artifact_id'>`; `EVIDENCE_ROLE_NOUN: Record<EvidenceRole, string>` ("linehaul sheet photo", "seal photo", "waybill photo", "proof-of-delivery photo", "receiver confirmation"); `EvidenceArtifact` gains required `phase_event_id: string | null` and `evidence_role: EvidenceRole | null` (update the 3 fixture files that build artifacts).

- [x] **Step 1: failing tests** — `test_backend_evidence_roles_match_shared_typescript_constant` (parse the TS constant the way the existing `STEP_SLUGS` parity test does); `test_every_phase_type_has_an_evidence_role_entry`; `test_every_role_names_an_existing_phase_column` (`hasattr(PhaseEvent, f"{role.value}_artifact_id")`); `test_pod_signature_is_not_driver_uploadable`.
- [x] **Step 2:** run, expect FAIL (names undefined).
- [x] **Step 3:** implement both sides.
- [x] **Step 4:** run the file, `tsc --noEmit` in dispatcher, driver-pwa and receiver, expect PASS.
- [x] **Step 5:** stage; suggested commit `feat(shared): evidence role vocabulary with backend parity`.

### Task 2: Columns, constraints, migration and reset

**Files:**
- Modify: `backend/app/db/models/evidence.py` — `phase_event_id: Mapped[Optional[uuid.UUID]]` with `ForeignKey("phase_events.id", use_alter=True, name="fk_evidence_artifacts_phase_event_id")` (no `ondelete`); `evidence_role: Mapped[Optional[EvidenceRole]] = mapped_column(String(30))`; `__table_args__` with `CheckConstraint("(phase_event_id IS NULL) = (evidence_role IS NULL)", name="ck_evidence_artifacts_attribution_pair")` and `Index("uq_evidence_artifacts_phase_role_hash", "phase_event_id", "evidence_role", "file_hash", unique=True, postgresql_where=text("phase_event_id IS NOT NULL"))`. Comment the *why* of each.
- Create: the migration (header docstring in the style of `2026_10_01_ciaran_pp_manifest_trips.py`; `upgrade`: add columns, FK, check, index; `downgrade`: reverse order). Verify with `grep -nE "op\.[a-z_]+\(" <file>`: only these operations.
- Modify: `backend/scripts/dev_reset_lifecycle.py` — before `_DELETE_ORDER`, run `UPDATE evidence_artifacts SET phase_event_id = NULL, evidence_role = NULL WHERE phase_event_id IS NOT NULL`, because the new FK and the existing `phase_events → evidence_artifacts` FKs form a cycle no delete order satisfies.
- Modify: `backend/app/schemas/evidence.py` — `EvidenceArtifactRead` gains `phase_event_id: UUID | None`, `evidence_role: EvidenceRole | None`.
- Test: `backend/tests/integration/test_artifacts.py`, `backend/tests/unit/test_dev_reset_lifecycle.py`, B1 snapshot.

- [x] **Step 1: failing tests** — `test_attribution_half_pair_violates_check` (constraint name asserted); `test_second_row_same_phase_role_hash_violates_unique`; `test_unattributed_rows_may_share_a_hash` (legacy duplicates stay legal); `test_reset_clears_attribution_before_deleting_phase_events` (extend the reset test's order check so the cycle is broken by the pre-delete update, not ignored).
- [x] **Step 2:** run, expect FAIL.
- [x] **Step 3:** implement model, migration, schema, reset.
- [x] **Step 4:** run the tests above; `UPDATE_SNAPSHOTS=1 backend/.venv/bin/pytest tests/baseline/test_b1_api_contract.py` and read the diff (expect only the two read fields); `alembic heads` shows one head. Do **not** apply the migration.
- [x] **Step 5:** stage; suggested commit `feat(db): attribute evidence artifacts to a phase and role`. Flag `enums.py` and the migration in the PR.

### Task 3: Attributed upload, identical-content deduplication and the upload event

**Files:**
- Create: `backend/app/orchestration/evidence/attribution.py`
- Modify: `backend/app/orchestration/evidence/artifacts.py`, `backend/app/core/exceptions.py`, `backend/app/core/realtime.py`, `backend/app/api/v1/endpoints/artifacts.py`, `backend/.importlinter` (evidence contract gains a bottom tier `attribution` below `geofence | proximity | location | artifacts`)
- Test: `backend/tests/unit/test_evidence_attribution.py` (new), `backend/tests/integration/test_artifacts.py`, `backend/tests/integration/test_artifact_upload_concurrency.py` (new), `backend/tests/unit/test_realtime.py`

**Interfaces:**
- Produces: `@dataclass(frozen=True) class EvidenceAttribution: phase_event_id: uuid.UUID; role: EvidenceRole`
- Produces: `async def validate_driver_attribution(db: AsyncSession, *, trip_id: uuid.UUID, attribution: EvidenceAttribution) -> None` — `ResourceNotFoundError("PhaseEvent", …)` when the phase is not on this trip; `EvidenceAttributionError` when the role is not in `EVIDENCE_ROLES[phase_type]` or not in `DRIVER_UPLOAD_ROLES`. No phase-state check (D4).
- Produces: `def cited_attribution_error(*, cited_role: EvidenceRole, phase_event_id: uuid.UUID, artifact_phase_event_id: uuid.UUID | None, artifact_role: EvidenceRole | None) -> str | None` — `None` when unattributed or matching, else a human message.
- Produces: `class EvidenceAttributionError(Exception)` in `core/exceptions.py`.
- Produces: `RealtimeKind.EVIDENCE_UPLOADED = "evidence_uploaded"` (default severity INFO).
- Changes: `create_artifact(..., attribution: EvidenceAttribution | None = None)` and `create_receiver_artifact(..., attribution: EvidenceAttribution | None = None)` — one added keyword each (the file already carries a `PLR0913` ignore; add no new function over five parameters). Private helpers: `_find_attributed_duplicate(db, *, attribution, file_hash)`; the insert runs inside `begin_nested`; on a unique violation of `uq_evidence_artifacts_phase_role_hash` re-select the winner and log the orphaned Storage key. The hash is computed from the bytes before the Storage upload, so a lookup hit skips the upload (D19). On a hit, compare the incoming `captured_at` with the stored one and log both at WARNING when they differ; never write it. `_persist_artifact` constructs the row with `created_at=datetime.now(UTC)` only after `upload_evidence_file` returns (D27), with a comment saying it is record-creation time, not commit time. Enqueue `TripEvent(id=trip_id, kind=EVIDENCE_UPLOADED)` on the trip's org only when a new row was written.
- Route: two optional `Form()` fields `phase_event_id: UUID | None`, `evidence_role: EvidenceRole | None`; exactly one present → 422; `EvidenceAttributionError` → 422.

- [x] **Step 1: failing tests**
  - unit: `cited_attribution_error` matrix (unattributed → None; same phase and role → None; other phase → message; other role → message).
  - integration (`test_artifacts.py`): `test_upload_with_attribution_stores_phase_and_role`; `test_upload_with_half_attribution_returns_422`; `test_upload_attributed_to_another_trips_phase_returns_404`; `test_upload_role_not_valid_for_phase_returns_422` (`seal_photo` on loading); `test_driver_cannot_upload_pod_signature_returns_422`; `test_identical_content_returns_existing_artifact_unchanged` (same id, one row, one event total, original `captured_at` kept when the retry sends a different one, warning logged); `test_retake_with_different_bytes_creates_second_artifact`; `test_upload_to_completed_phase_is_accepted`; `test_unattributed_upload_unchanged`; `test_new_attributed_upload_enqueues_one_info_evidence_event` (read the session outbox as `test_realtime_emit.py` does; assert `severity == info`, payload ids only); `test_rolled_back_upload_leaves_no_row_and_publishes_nothing` (create, then roll back the session; a fresh session finds no row and the publish mock was never called).
  - concurrency (`test_artifact_upload_concurrency.py`, own module, two independent connections, committed seed, cleanup afterwards, modelled on `test_handover_token_concurrency.py` because the shared savepoint fixture can never race): `test_two_simultaneous_identical_uploads_store_one_row` (both calls return the same id; exactly one row; exactly one event published); `test_simultaneous_retake_and_original_store_two_rows`; `test_upload_paused_across_cancellation_is_recorded_after_it` (the Storage fake, mid-upload, cancels the trip on a second connection and commits; the artifact's `created_at` is later than `trip.closed_at`); `test_upload_paused_across_override_is_recorded_after_it` (same, overriding the phase; `created_at` later than the phase's `completed_at`).
  - integration (`test_artifacts.py`), added: `test_created_at_is_stamped_after_storage` (the Storage fake records the time it returned; `created_at` is not earlier); `test_deduplicated_retry_keeps_original_created_at`.
- [x] **Step 2:** run, expect FAIL.
- [x] **Step 3:** implement.
- [x] **Step 4:** run the files; `ruff check .`, `lint-imports` (contract count unchanged, evidence contract now lists `attribution`), `python scripts/check_structure.py`; update the B1 snapshot (two Form fields) and read the diff.
- [x] **Step 5:** stage; suggested commit `feat(storage): attributed evidence upload with identical-content deduplication`.

### Task 4: Completion validates attribution; receiver confirmations are attributed

**Files:**
- Modify: `backend/app/orchestration/phases/artifacts.py` — keep the name `_assert_artifacts_belong_to_trip` (D18); new signature below; select `id, file_hash, phase_event_id, evidence_role, captured_by_driver_id`; ownership rule unchanged; attribution checked with `cited_attribution_error`; for the `POD_SIGNATURE` key, an artifact with a driver id raises `EvidenceAttributionError` (D8b).
- Modify: `advance_loading.py`, `advance_departure.py`, `advance_arrival.py`, `advance_confirmation.py` — pass `cited={EvidenceRole.X: payload.x_artifact_id, ...}` and `phase_event_id=event.id`. The check stays after `_gate_and_load` (so the resolved-phase shortcut is untouched, D26) and before any evidence column is written.
- Modify: `backend/app/api/v1/endpoints/phases.py` — `EvidenceAttributionError` → 422 on the completion route.
- Modify: `backend/app/orchestration/handover/service.py` — `record_receiver_confirmation` passes `attribution=EvidenceAttribution(phase_event_id=token.phase_event_id, role=EvidenceRole.POD_SIGNATURE)`. **Tell Tim before merging.**
- Test: `backend/tests/integration/test_phases.py`, `backend/tests/integration/test_handover_endpoints.py`

**Interfaces:**
- Changes: `async def _assert_artifacts_belong_to_trip(db: AsyncSession, *, trip_id: uuid.UUID, phase_event_id: uuid.UUID, cited: Mapping[EvidenceRole, uuid.UUID | None]) -> dict[uuid.UUID, str]` — `None` values skipped as today; returns digests as today.

- [x] **Step 1: failing tests**
  - `test_completion_citing_artifact_attributed_to_another_phase_returns_422` (phase stays pending, column null, no anchor dispatched).
  - `test_completion_citing_wrong_role_returns_422` (linehaul-role artifact as seal photo).
  - `test_completion_accepts_unattributed_artifact`.
  - `test_completion_after_retake_records_the_cited_photo` (two attributed uploads, cites the second; the first untouched).
  - `test_confirmation_rejects_unattributed_driver_upload_as_receiver_confirmation` (driver uploads without attribution, cites it as `pod_signature` → 422).
  - `test_confirmation_rejects_driver_pod_photo_as_receiver_confirmation` (attributed `pod_photo` → 422).
  - `test_confirmation_accepts_unattributed_artifact_without_driver_id` (pre-deploy receiver images and fixtures keep working).
  - `test_completion_request_for_overridden_phase_returns_recorded_state` (D26: 200; status stays overridden; every evidence column unchanged; no anchor dispatched; even when the request cites a contradictory artifact).
  - `test_completion_request_for_completed_phase_with_new_key_returns_recorded_state` (no key comparison; evidence unchanged).
  - `test_completion_of_pending_phase_on_cancelled_trip_returns_409`.
  - handover: `test_receiver_confirmation_image_is_attributed_to_its_phase` and `test_receiver_confirmation_enqueues_evidence_event`.
- [x] **Step 2:** run, expect FAIL.
- [x] **Step 3:** implement.
- [x] **Step 4:** run both files plus `tests/baseline` (B3 hashes must not change); `ruff`, `lint-imports`, `check_structure`.
- [x] **Step 5:** stage; suggested commit `feat(orchestration): reject contradictory evidence attribution at completion`.

### Task 5: Backend contract review checkpoint

No code. Stop here before any frontend work.

- [x] Fresh reviewer reads the Task 2–4 diff against this plan's contract table and Decisions D3–D8b, D17–D19, D22, D26, D27: migration operations (`grep -nE "op\.[a-z_]+\("`), model/migration parity, the two route contracts, the B1 snapshot diff, the gate untouched (`git diff -- backend/app/orchestration/phases/gate.py` is empty).
- [x] Full backend suite alone; `ruff`, `lint-imports`, `check_structure`, `mypy`.
- [x] Ciaran decides: proceed, or amend the contract (and this plan) before Task 6.

**Status (2026-10-12):** Tasks 1–5 done; Deviation 1 accepted. Backend suite 2905 passed / 4 skipped.

### Task 6: Driver app sends attribution and ignores superseded upload results

**Files:**
- Modify: `frontend/driver-pwa/lib/api/artifacts.ts` — `UploadArtifactParams` gains `attribution?: { phaseEventId: string; role: EvidenceRole }`; both form fields appended together or not at all.
- Modify: `frontend/driver-pwa/lib/hooks/useArtifactUpload.ts` — `useArtifactUpload(tripId: string, phaseEventId: string)`; `uploadNow(dataUrl: string, artifactType: ArtifactType, capturedAt: string, role: EvidenceRole): Promise<string | null>`; a per-role latest-request ref so an older request resolves `null` once a newer one for the same role has started (alongside the existing unmount guard).
- Modify: `components/phase/steps/loading/Linehaul.tsx`, `departure/CaptureSeal.tsx`, `arrival/SealVerify.tsx`, `confirmation/PodPhoto.tsx` — pass `phase.phase_event_id` and the role.
- Modify: `frontend/driver-pwa/lib/api/phases.ts` — `artifactIdFor` takes one object `{ tripId, artifactType, readyId, dataUrl, capturedAt, attribution }`; each phase case passes its role (legacy departure waybill: `waybill_photo`). The receiver confirmation id is passed through unchanged. Offline queue entry shape unchanged: `phaseEventId` is already on the entry.
- Test: `lib/hooks/__tests__/useArtifactUpload.test.ts` (new), `lib/api/__tests__/artifacts.test.ts`, `lib/api/__tests__/phases.test.ts`, step tests (`steps/__tests__/linehaul.test.tsx`, `departure/__tests__/CaptureSeal.test.tsx`, `arrival/__tests__/SealVerify.test.tsx`, new `confirmation/__tests__/PodPhoto.test.tsx`).

- [ ] **Step 1: failing tests** — hook: `retake before the first upload resolves keeps the retake` (first resolves `null`), `unmount resolves null`, `attribution is forwarded`; api: `sends both attribution fields or neither`; phases: `fallback upload carries the phase and role`, `ready id skips the upload`, `queued replay uploads with attribution`; each step: `captures with this phase and the step's role`.
- [ ] **Step 2:** run, expect FAIL.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** driver-pwa `vitest run`, `tsc --noEmit`, `npm run lint`.
- [ ] **Step 5:** stage; suggested commit `feat(driver-pwa): attribute captures to their phase and ignore superseded uploads`. Compatibility: an older APK keeps uploading unattributed and still completes (Task 4 accepts it).

### Task 7: Dispatcher refreshes only the resources an event changes

**Files:**
- Modify: `frontend/dispatcher/lib/realtime/types.ts` — add `'evidence_uploaded'`; `KIND_CHANGES_TRIP_RECORD: Record<RealtimeKind, boolean>` (`evidence_uploaded: false`, everything else `true`); derived `TRIP_RECORD_KINDS: readonly RealtimeKind[]`.
- Modify: `lib/hooks/useTripResource.ts` — `useTripResource<T>(tripId, suffix, initial, kinds?: readonly RealtimeKind[])` forwarded to `useLiveResource`.
- Modify: `useTripDetail.ts`, `useManifest.ts`, `useTrips.ts` pass `TRIP_RECORD_KINDS`; `useTripArtifacts.ts` passes nothing (all kinds).
- Test: `lib/hooks/__tests__/useTripResource.test.tsx`, `lib/realtime/ranking.test.ts`, a `useTrips` test (extend the existing one, or create `lib/hooks/__tests__/useTrips.test.tsx` if none exists).

- [ ] **Step 1: failing tests** — `evidence_uploaded refreshes artifacts but not the trip record`; `phase_completed refreshes both`; `reconnect refreshes every filtered resource` (Review Focus 3); `live trip list ignores evidence_uploaded`; ranking: `evidence_uploaded raises no toast`.
- [ ] **Steps 2–4:** fail, implement, dispatcher `vitest run` + `tsc --noEmit`.
- [ ] **Step 5:** stage; suggested commit `feat(dispatcher): scope live refreshes by event kind`.

### Task 8: `buildPhaseActs`, the pure row model

**Files:**
- Create: `frontend/dispatcher/lib/phase/acts.ts`, `frontend/dispatcher/lib/phase/acts.test.ts`

**Interfaces:**
```ts
export type EvidenceActState = 'uploaded' | 'submitted' | 'not_submitted' | 'after_close' | 'trip_cancelled'
export type EvidenceProvenance = 'driver' | 'receiver' | 'unknown'
export type PhaseAct =
  | { kind: 'evidence'; key: string; role: EvidenceRole; artifactId: string
      provenance: EvidenceProvenance; state: EvidenceActState
      metadataAvailable: boolean; takenAt: string | null; receivedAt: string | null
      receivedAfterCancellation: boolean }
  | { kind: 'completion'; key: string; outcome: 'completed' | 'exception' | 'overridden'
      confirmedAt: string | null; recordedAt: string }
  | { kind: 'exception'; key: string; exceptionId: string; at: string }
  | { kind: 'expected'; key: string; role: EvidenceRole | null; reason: 'evidence' | 'driver_confirmation' | 'warehouse_scan' }
export interface PhaseActsInput {
  phase: PhaseDescriptor
  isActive: boolean            // phase_event_id === currentTripPhase(trip)?.phase_event_id
  tripStatus: TripStatus
  tripClosedAt: string | null  // set by cancel_trip and by closure
  artifacts: readonly EvidenceArtifactWithUrl[]
  exceptions: readonly TripException[]
}
export interface PhaseActSummary { recorded: number; exceptions: number; unreviewed: number; anchor: AnchorStatus }
export function buildPhaseActs(input: PhaseActsInput): PhaseAct[]
export function summarisePhaseActs(phase: PhaseDescriptor, acts: readonly PhaseAct[], exceptions: readonly TripException[]): PhaseActSummary
export const RECEIVED_GAP_DISPLAY_MS = 120_000
```
Rules:
- **Which artifacts:** every artifact attributed to this phase, plus every id the phase's role columns cite (`EVIDENCE_ROLE_FIELD`), whether or not that id is in `artifacts`. A cited id missing from `artifacts` still yields a row with `metadataAvailable: false` and null times (D25).
- **Visibility:** resolved phase → evidence rows always produced. Unresolved phase → produced only when `isActive`, or when `tripStatus === 'cancelled'` and the phase has at least one attributed upload (D23). Any other unresolved phase → `[]` (an upload claiming a future phase stays hidden, D4).
- **State** (D24): resolved → `submitted` if cited; else `after_close` when `created_at > completed_at`, else `not_submitted` (overridden phases use the same rule against `completed_at`). Unresolved on a cancelled trip → `trip_cancelled`, with `receivedAfterCancellation = created_at > tripClosedAt`. Unresolved and active on a running trip → `uploaded`. Capture order never sets state.
- **Provenance** (D8): `receiver` only when `evidence_role === 'pod_signature'` and `phase_event_id === phase.phase_event_id`; `driver` when `captured_by_driver_id` is set; otherwise `unknown`.
- Completion row only when `completed_at` is set. Exception rows use the existing `exceptionEventTime` rule, moved from `TripTimeline.tsx` into this module so both use one definition.
- **Expected rows** only when `isActive` and the trip is not cancelled: one per role in `EVIDENCE_ROLES` (except `waybill_photo`) with no attributed upload and no cited id, then `driver_confirmation`; `warehouse_scan` instead when `phase.blocked_on === 'warehouse_scan'`.
- **Order:** event time ascending (`takenAt`, `confirmedAt ?? recordedAt`, `at`; unknown times sort after known ones), ties by `key`; expected rows last.

- [ ] **Step 1: failing tests**
  - normal completed departure (one submitted seal photo, completion row).
  - two uploads for one role on the active phase → both `uploaded`, no "replaced"; after completion → `not_submitted` and `submitted` per the column, whatever their capture order.
  - upload after completion → `after_close`.
  - overridden phase with an upload → `not_submitted` or `after_close`, completion row "overridden".
  - **cancelled trip**: the active phase's uploads appear as `trip_cancelled`, one flagged `receivedAfterCancellation`; no expected rows; a later pending phase returns `[]`.
  - upload attributed to a future phase → not shown on it while pending.
  - **cited artifact missing from the list** → one row, `metadataAvailable: false`, null times, state `submitted` (Review Focus 5).
  - provenance: attributed `pod_signature` → `receiver`; unattributed id cited as `pod_signature` with no driver id → `unknown`; artifact with a driver id → `driver`.
  - receiver confirmed before the driver completes → receiver row plus expected `driver_confirmation`.
  - offline arrival (taken 14:04, received 14:41, confirmed 14:18 on device, recorded 14:41).
  - **expected rows never assert absence** (Review Focus 1: an unattributed upload exists; the row is still `expected`, no "missing" state exists in the type).
  - **device clock ahead of server** (Review Focus 2: stable order, both times kept, state unaffected).
  - blocked on warehouse scan; exception ordered among photos by capture time.
- [ ] **Steps 2–4:** fail, implement, `vitest run lib/phase/acts.test.ts`.
- [ ] **Step 5:** stage; suggested commit `feat(dispatcher): derive each phase's evidence rows`.

### Task 9: The rail on the trip timeline (detail panels unchanged)

**Files:**
- Create: `frontend/dispatcher/components/domain/PhaseActs.tsx` (+ `components/domain/__tests__/PhaseActs.test.tsx`) — props `{ acts: readonly PhaseAct[]; live: boolean; phaseLabel: string; artifactsById: Map<string, EvidenceArtifactWithUrl>; artifactLoading: boolean; artifactError: string | null; onRetryArtifacts: () => void; exceptionsById: Map<string, TripException> }`. Evidence rows render the existing `EvidencePhoto` / `EvidenceDocument` with `artifactId` and the possibly-undefined `artifact`, so "Recorded artifact unavailable" and "Evidence lookup failed" come from the existing component. Receiver wording by provenance (D8). Exception rows reuse `fmtExceptionType`, `EXCEPTION_SEVERITY_META` and the contact-method labels in `ReviewFields.tsx` (export them if not exported). Several uploads for one role are grouped under "{n} photos uploaded" and collapse beyond the first with "+{n − 1} more". New rows highlight only when `live`.
- Modify: `components/trips/TripTimeline.tsx` — compute `active = currentTripPhase(trip)` once and pass `isActive`, `tripStatus`, `tripClosedAt` to the builder; active running phase → `persistentContent={<PhaseActs live … />}`; resolved phase → `summary` gains the acts summary string and `children` renders `<PhaseActs live={false} …/>` above `<PhaseEvidence>`; the cancelled trip's unresolved phase with uploads → `persistentContent={<PhaseActs live={false} …/>}` even though `showEvidence` is false; in_transit and trip_creation unchanged. The detail panels keep their photos in this task.
- Test: `PhaseActs.test.tsx`, `components/trips/TripTimeline.test.tsx`.

- [ ] **Step 1: failing tests** — PhaseActs: wording per row kind and state; device/server labels; "Receiver confirmed delivery" only for `receiver` provenance, "Submitted as receiver confirmation" otherwise; `groups several uploads for one role` (Review Focus 4); highlight only when live. TripTimeline (builder and component together): active phase rows visible without expanding; resolved phase shows the summary and hides rows until opened; a photo appears after the artifacts resource refreshes; **a submitted photo whose metadata failed to load still shows "Recorded artifact unavailable"** (Review Focus 5); **cancelled trip shows the unfinished phase's uploads with no waiting rows and no highlight**; a resolved phase receiving a late upload or an anchor receipt updates with no live styling; a 13-phase cross-dock renders one active card.
- [ ] **Steps 2–4:** fail, implement, dispatcher `vitest run`, `tsc --noEmit`, `npm run lint`.
- [ ] **Step 5:** stage; suggested commit `feat(dispatcher): live evidence rows inside each phase card`.

### Task 10: Preview the hard cases before removing anything

**Files:**
- Create: `frontend/dispatcher/components/domain/__fixtures__/phase-acts.ts` — scenarios built from `makePhasePlan` (`shared/lib/mocks/phase-trips.ts`): normal single-leg trip; 13-phase cross-dock mid-trip; offline arrival; three seal uploads on the active phase; missing corroboration (tracker dark); **cancelled mid-phase with uploads**; **submitted evidence whose metadata is unavailable**; anchor pending on two completed phases; unattributed signature (neutral wording).
- Modify: `frontend/dispatcher/app/dev/design/page.tsx` — a "Trip timeline scenarios" section rendering `TripTimeline` per scenario with real components and tokens.

- [ ] **Step 1:** add fixtures and the section.
- [ ] **Step 2:** start the dispatcher preview, open `/dev/design`, check each scenario at desktop and 375 px width, in light and dark; read the page for wording; screenshot the 13-phase, cancelled and unavailable-evidence cases for the PR.
- [ ] **Step 3:** Ciaran reviews the screenshots and confirms the rows can replace the panel photos.
- [ ] **Step 4:** stage; suggested commit `chore(dispatcher): timeline scenarios on the dev design page`.

### Task 11: Move photos out of the detail panels

**Files:**
- Modify: `frontend/dispatcher/components/domain/LoadingDetail.tsx`, `DepartureDetail.tsx`, `ArrivalDetail.tsx`, `ConfirmationDetail.tsx` — remove the `EvidencePhoto` / `EvidenceDocument` blocks now owned by rows; keep seal number, comparisons, location, override.
- Test: the four detail components' existing tests; `TripTimeline.test.tsx`.

- [ ] **Step 1: failing tests** — each panel no longer renders its photo; `TripTimeline` renders each submitted artifact exactly once.
- [ ] **Steps 2–4:** fail, implement, dispatcher `vitest run`, `tsc --noEmit`.
- [ ] **Step 5:** stage; suggested commit `refactor(dispatcher): photos live in their phase rows, not the detail panels`.

### Task 12: Gates, end-to-end check and hand-off

- [ ] Backend: full `backend/.venv/bin/pytest` (alone, foreground), `ruff check .`, `lint-imports`, `python scripts/check_structure.py`, `mypy` as CI runs it. Compare against the baselines recorded in Task 1.
- [ ] Frontend: dispatcher, driver-pwa and receiver `npm test` / `npx tsc --noEmit` / `npm run lint` (receiver only for the shared type change).
- [ ] End-to-end on a local stack (after Ciaran applies the migration to a local DB only): create a trip, activate, take the linehaul photo in the driver app and watch it appear on the dispatcher without a reload; take two seal photos; go offline for arrival and reconnect; confirm as receiver; cancel a second trip mid-phase after an upload; check the trip list did not refetch on uploads (network panel).
- [ ] TASK COMPLETE block per CLAUDE.md, listing shared files (`enums.py`, `core/realtime.py`, `core/exceptions.py`, `.importlinter`, `frontend/shared/*`, B1 snapshot) and the migration.

---

## Migration and deployment order

1. `git fetch origin`; confirm `dev` has no unmerged migration; set `down_revision` to the single head.
2. Merge the branch to `dev` (PR flags: migration, shared files, Tim's `handover/service.py` change).
3. Ciaran applies the migration to the shared dev database **from `dev`**.
4. Deploy the backend. Old dispatcher and old driver builds keep working: the columns are nullable, the Form fields optional, unknown realtime kinds just trigger a refetch.
5. Deploy the dispatcher and the receiver app (shared type only).
6. Ship the driver PWA and rebuild the APK.
7. Whoever merges to `dev` rebuilds the Graphify output.

The structural freeze (19 Oct) concerns package moves; this plan moves nothing, but the migration should still land before it.

## Acceptance scenarios

1. Early upload slow, driver swipes, fallback re-uploads the same bytes, both land: one artifact row, completion cites it, one "Submitted at completion" row.
2. Photo A, retake B, A's response arrives after B: the draft keeps B, completion cites B. While the phase is active both read "Uploaded"; after completion A reads "Not submitted" and B "Submitted at completion".
3. Retake after navigating back to the step: the old instance's result is ignored; same outcome as 2.
4. Offline arrival: rows read "Taken 14:04 · Received 14:41" and "Confirmed 14:18 on device · recorded 14:41".
5. Queue replay after a lost response (new idempotency key): the upload deduplicates; completion returns the recorded phase with 200; no new rows, no event, no new anchor; the driver app reads `phaseStatus`.
6. Override while an upload is in flight: the upload is stored attributed; a later completion request returns 200 with the phase still overridden and its evidence unchanged; the card reads "Closed by dispatcher override" and the photo "Received after the phase closed".
7. Cancel while an upload is in flight: the upload is stored; a completion request gets 409; the cancelled card still shows the upload as "Not submitted — trip cancelled" (or "Received after the trip was cancelled"), with no waiting rows.
8. Forged citation on an **open** phase (another phase's or another role's attributed artifact, or a driver upload as the receiver confirmation): 422; phase untouched; no anchor queued. The same request against a resolved phase returns 200 with the recorded state.
9. Older driver build: uploads unattributed; the active phase shows "Expected: seal photo"; after completion the submitted photo appears from the phase column.
10. Receiver confirms before the driver completes: "Receiver confirmed delivery · {time} (server time)" appears live on the active confirmation card, followed by "Waiting for the driver to confirm Confirmation".
11. Anchor delayed: the completed card shows "Anchoring pending" with no live styling, then "Anchored {time}" when polling picks up the receipt.
12. Uploads never refetch the trip record, the manifest or the trip list; the artifacts resource refetches once per burst.
13. Tracker dark: the existing location chip reads "Not verified"; no photo row carries a location claim.
14. Artifacts request fails: every submitted photo still shows as recorded with "Evidence lookup failed" and a retry, nothing disappears.
15. Two identical uploads race on separate connections: one row, one event, both callers get the same id.

## Follow-ons (not in this plan)

- **F1** Commit capture context (capture and receipt times, producer, location assessment, handover record) in a versioned payload. Design with FP-290, which needs the same payload versioning and verifier dispatch.
- **F2** Require every cited `pod_signature` to be attributed (or to match the phase's `HandoverConfirmation`), once no pre-deploy receiver images are in flight. Tim's area.
- **F3** Show the handover record on the dispatcher: the receiver's identity-check tier and outcome (Didit document and face, selfie, typed only, declined), and the receiver position verdict. Tim's area.
- **F4** Scan-session rows, once session closure is stored and the scan feed has a real implementation.
- **F5** Exception review history (several actions per exception), if the product needs it; today there is one review record.

## Remaining uncertainties

- Whether F2 should come forward into this plan. D8b closes the realistic case (a driver citing their own upload); F2 would also exclude seed rows and pre-deploy images, and touches Tim's flow.
- Real receiver images confirmed before deploy will read "Submitted as receiver confirmation". Only test data exists today, so this is accepted.
- `shared/lib/utils/render-attestation.ts` says the driver app also draws this image; it no longer does (`ReceiverHandover.tsx`). D8b relies on that staying true; the stale comment is outside this plan's scope.
