# Live Evidence Rail (FP-287 + FP-288) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **lean plan**: it fixes decisions, interfaces and test cases; the implementer writes the code. Claude never commits — every "commit" step means: stage the named files, Ciaran reviews and commits.

**Revision 2 (2026-10-12):** amended after an external review. Changes: receiver provenance (D8, D8b), active/cancelled context for the row builder (D12, D23), no "replaced" inferred from timestamps (D24), rows survive missing artifact metadata (D25), the replay/override contract corrected to match `gate.py` (D26), identical-content deduplication wording (D5), real concurrency and rollback tests, a backend review checkpoint (Task 5), and the panel-photo removal moved after the preview (Tasks 9–11).

**Revision 3 (2026-10-12):** the server "received" time is defined and stamped explicitly after the Storage upload (D27), because the column's `now()` default is the transaction's start; tests cover an upload paused across cancellation and override. Lint commands use the repository's `npm run lint`.

**Revision 4 (2026-10-13):** the dispatcher timeline is redesigned before Tasks 8–10 are built. Source of truth: [2026-10-13 phase timeline redesign](../../design-notes/2026-10-13-phase-timeline-redesign.md) (decision, per-phase content contract §7, open items §9). Changes here: each card is three zones (Recorded, Checked, Audit trail) under a header verdict (D28, D29); layout C with a stacked fallback (D30); in-transit is always open while happening and after (D31); anchor rows and the audit trail are forensic-only (D32); exception rows on the timeline open the exceptions panel and `PhaseExceptionGroup` is removed (D33); checks run only after completion (D34); `absent` rows (D35); copy fixes and a type scale (D36, D37). `PhaseAct` gains `milestone`, `anchor` and `absent`; Task 8 is split into 8 and 8b; Task 9 is split into 9 and 9b (reordered in Revision 5); Task 10 previews the real `TripTimeline`; Task 11 is re-scoped (D13 amended). Tablet and desktop only: there is no mobile layout. **Nothing in Revision 4 is built; it is recorded for verification first.**

**Revision 5 (2026-10-13):** verification of Revision 4. Task 9b's panel half moves before Task 9 as **Task 9a**, and the timeline half (rows replace `PhaseExceptionGroup`, "Show in timeline" points at the row) folds into Task 9, so no commit renders an exception twice. Task 9 gains a "nothing lost" test per design note §2 inventory row, and a build order in which the side-by-side split is last and the only droppable step (submission 23 Oct). Stale Revision 1–3 wording fixed: D9, the expected-row verbs, acceptance scenarios 10 and 13, and the Goal. Execution order: 8, 8b and 9a (independent) → 9 → 10 (stop for review) → 11 → 12.

**Revision 6 (2026-10-13):** external review of Revision 5. (1) `departureSealForLeg` skipped departures with a null seal and could return an earlier leg's seal; it now takes the immediately preceding departure, as the backend's `_find_departure_for_leg` does (D40, fixed in Task 8). (2) The verdict gets the leg's departure and arrival times, so "time on the road" is computable (D41). (3) `onOpenException` accepts a null phase for trip-level exceptions, and "Show in timeline" reveals a row hidden by the cap (D42). (4) The location check is two checks, truck geofence and driver proximity, never merged (D43). (5) The `clean` outcome reads **"Checks passed"**, not "Clean" (D44). (6) Task 10 previews real fixture photos, long descriptions and 200 % zoom. Where this plan and the design note disagree, this plan wins.

**Goal:** Every photo a driver captures, and the receiver's confirmation, appears in the right phase card on the dispatcher's trip timeline as it lands, and every phase reads as a short, honest record of what was captured, what was submitted, what was raised and, in forensic mode, what was anchored.

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
- Dispatcher UI follows `frontend/DESIGN_SYSTEM.md` (principles §1.2, colour §2, typography §5 including the numeric rule §5.2, icons §6) and reuses `components/ui/` primitives (`Chip`, `Button`, `Card`, `SecHead`, `InfoRow`, `Ic`, `Modal`, `DetailPanel`) before writing new markup. The D37 tokens are named aliases of DESIGN_SYSTEM roles, with that file's weights and letter-spacing: `text-label` = Label-M, `text-meta` = Body-S, `text-body` = Body-M, `text-title` = Title-S. Colour only through the Tailwind semantic tokens (no hex; `eslint.config.mjs` allows hex only in `lib/tokens.ts`). The mockups in `app/dev/design/_timeline-options/` and the screenshots in `docs/design-notes/assets/2026-10-13-phase-timeline/` are the visual reference; their code is throwaway and is not copied.
- Dispatcher UI built in Revision 4 uses only the four type tokens (`text-label`, `text-meta`, `text-body`, `text-title`, defined in `frontend/dispatcher/tailwind.config.ts`), never `text-[Npx]`; anchor rows, the audit trail and any receipt/hash/verify control render only inside `ForensicOnly` [design note §5.4, §7.3].
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
| Phase completion | Per-phase verb (design note §7.5): "Driver confirmed loading", "Driver confirmed delivery", in_transit "Arrived {destination}"; exception variant "{text} — exception recorded"; override "Closed by dispatcher override" with the note and "Authorised by". Recorded values ride on the row: seal number, scanned count, driver's blind count, seal condition | `phase_events` | the row itself | "Confirmed {driver_captured_at} on device · recorded {completed_at}" (second part only when ≥ 2 min apart) | stored | Phase identity; **no times**. Hedera consensus time proves the committed hashes existed no later than that instant |
| Exception raised | A **row that opens the exceptions panel** (D33): type, severity chip, time, source, review state, two-line description. The full record is only in the panel | `exceptions` (driver or system) | `exceptions.phase_event_id` | existing `exceptionEventTime` rule | stored | No (FP-290) |
| Exception review | Part of the exception row: "Needs review" · "Recorded" · "Reviewed · {outcome} · {contact method}" | `exceptions.review_*`, `contact_method` | via the exception | `reviewed_at` (server) | stored; latest review only | No (FP-290) |
| Expected evidence (active phase only, trip not cancelled) | "Expected: {role noun}" · "Waiting for the driver to confirm {verb}" (per-phase verbs, design note §7.5: "confirm delivery", not "confirm Confirmation") · in_transit "En route to {destination} · expected {time}" · "Waiting for the warehouse scan to finish" | `EVIDENCE_ROLES` + `phase.blocked_on` | — | none | derived | n/a |
| Anchor row (**forensic mode only**, D32) | "Anchored {consensus time}" · "Anchoring pending". "Anchor failed — receipt still owed" stays visible to everyone as today and is not part of the verdict | `phase.anchor_status`, receipt | phase | Hedera consensus | stored | It is the commitment |
| Location check | Two lines in **Checked** (D43): "Truck within precinct tolerance" and, when assessed, "Driver with truck"; coordinates, capture times, boundary and the map behind "Location details" (existing `PhaseLocationSection` / `LocationEvidencePanel`, unchanged) | `action_location_assessment` | phase | as today | stored | No (off-chain by design) |

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

### Rail placement and live behaviour (Revision 4)

The per-phase contract is [design note §7](../../design-notes/2026-10-13-phase-timeline-redesign.md); this table is its summary. Zones: **Recorded** (rail rows), **Checked** (comparisons, only after completion), **Audit trail** (forensic only).

| Phase state | What shows |
|---|---|
| Not started, or not reached on a cancelled trip with no uploads and no exceptions | Dashed card, chip, stop line. Nothing else |
| Current phase, nothing yet | Verdict "Current phase · waiting for the driver"; Recorded = dashed expected rows (D15); Checked = "Checks appear when the driver confirms {phase}" (Loading/Unloading add the live scan count as "in progress"). Open by default |
| In progress (uploads exist) | Verdict "In progress · …", or "Needs attention · …" if an exception needs review; uploaded rows with a short `motion-safe` highlight when new; exception rows; expected rows. Open by default |
| Resolved (completed / exception / overridden) | Verdict (D29). Collapsed by default; opened it shows Recorded, Checked and, in forensic mode, Audit trail. Late uploads, reviews and receipts update silently (no highlight). A collapsed card shows its exception rows (max 3 + "+n more") under the verdict (D33) |
| Unresolved phase of a **cancelled** trip with attributed uploads or exceptions | Rows visible in `trip_cancelled` state (D23); no verdict, no expected rows, no highlight |
| **in_transit**, active or resolved | **Always open, no toggle** (D31): Recorded = Departed, exception rows, Arrived or the dashed "En route…" rows; Checked = the standing seal line, the named absence and the location line; Audit trail in forensic mode |
| in_transit not started | Dashed "Not started" card |
| trip_creation | `TripCreatedDetail`, unchanged |

Layout inside an open card (D30): Recorded and Checked side by side when the card body is at least 740 px wide, the phase has at least one check and it is not in_transit; otherwise stacked. Audit trail is always below, forensic only.

The old `*Detail` panels are **unmounted in Task 9** and deleted in Task 11 (D13 amended), so each artifact and each check is rendered in exactly one place.

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
| D9 | Corroboration stays phase-level: one location line in **Checked** with the raw fixes behind "Location details" (Revision 4 replaces the summary chip and the panel section, D28). Photo rows carry no location claim. No witness glyph, separation gauge or evidence-tier badge | A completion-time tracker check cannot vouch for an earlier photo; the chip already states the verdict in words | Witness and Pattern artifact |
| D10 | Rows are assembled client-side by one pure function from resources the page already loads. No new read endpoint, no trip-detail schema change | The data is already on the page; one function is the seam a future ledger would replace | — |
| D11 | No scan-session rows; only the existing "waiting for the warehouse scan" state | Closure time is not stored and the feed is mock-only | Ledger artifact (scan-complete events) |
| D12 | **Active** means the phase `currentTripPhase` returns for the whole plan. Active phase: rows always visible and highlighted live. Resolved phase: a summary line always visible, rows behind the disclosure, updates silent | Current and future phases are both `pending`; density at 13 phases; the summary states what is behind the chevron | Ledger artifact Rule 1, for resolved phases only; review finding 2. **Resolved-phase summary line superseded by D28 (header verdict)** |
| D13 | Photos move from the four detail panels into their rows, after the dense, cancelled and unavailable cases have been previewed | One rendering per artifact, without removing the old view before the new one is proven | Review process note **(amended by D38: the panels are unmounted in Task 9, deleted in Task 11)** |
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
| D28 | Every card is three zones: **Recorded** (what happened, in order), **Checked** (was it right), **Audit trail** (can it be proved). Checked is empty until the phase completes. Supersedes D12's resolved-phase summary line ("4 recorded · … · Anchored") with the header verdict | The three kinds of information are read differently; the old summary mixed them and led with the anchor | D12 (resolved phase), Review Focus summary |
| D29 | The collapsed header carries one **outcome** (icon, word, reasons): `overridden` > `attention` > `reviewed` > `unverified` > `clean` > `in_progress`. `attention` also applies to unresolved phases (an unreviewed exception outranks "In progress"). `clean` needs no exception, no flagged check, nothing unrun and at least one pass, and is never awarded to in_transit. The anchor state is not an input. The rail node turns amber for every `attention` | "Did this phase go cleanly?" must be answerable without opening it; a dark tracker is `unverified`, not `clean` | — |
| D30 | **Layout C with a stacked fallback**: side by side when the card body is ≥ 740 px (measured by a `ResizeObserver` on the card, not a viewport query), the phase has ≥ 1 check and it is not in_transit; otherwise stacked. Tablet and desktop only | The card is 772 px at 1440 and on a 1024 tablet, 676 px at 1280 with the panel docked, 564 px on a 768 tablet | — |
| D31 | The **in_transit card is always open, with no toggle, while the leg is happening and after it has happened** (active or resolved, including exception and overridden). A leg not yet started is a collapsed "Not started" card | In-transit is where theft signals arrive; it is never worth hiding. Today only the active leg is always open | — |
| D32 | **Anchor rows, the Audit trail zone and every receipt, hash and Verify control render only in forensic mode** (`ForensicOnly`), on every phase. The builder still produces the anchor act; the component gates it. "Anchor failed — receipt still owed" stays visible to everyone as today and is not in the verdict. Override note and "Authorised by" stay visible in the completion row | Anchoring is not something every dispatcher needs on every phase; the journey-lock block is already gated this way | — |
| D33 | **An exception on the timeline is one compact row that opens that exception in the exceptions panel** (docked at ≥ 1280 px, modal below). `PhaseExceptionGroup` and the timeline's exception cards are removed. The panel gains "Supporting evidence" and a way to select one exception (`exception=<id>`). A collapsible card shows its rows under the verdict while collapsed (max 3, then "+n more" opening the panel filtered to the phase) and in the rail when open, never both | The panel is the review surface; the timeline duplicated it. Removing the branch must not hide an exception behind a closed card | — |
| D34 | Checks run only after completion. An unresolved phase never asserts absence: the active Arrival card no longer says "No seal present"; Loading/Unloading show the live scan count as "in progress", never pass/fail | Review Focus 1, applied to Checked | — |
| D35 | A **resolved** phase whose role column is null, with no attributed upload for that role, gets an `absent` row ("No seal photo submitted at completion"). Never for an active phase, an overridden phase, or a role the phase type does not have (activation, in_transit, unloading have none) | Today's "Not captured" must not vanish silently; the absence of a submitted photo on a closed phase is a recorded fact | D15 (unchanged for active phases) |
| D36 | Copy: the receiver artifact is "Receiver confirmed delivery · Attestation image" (not "POD signature (Ed25519)": nothing signs it, and "Ed25519" appears nowhere in `backend/app`); counts use a dispatcher-only `countLabel(n, noun)` so "1 parcel unaccounted for"; completion rows use the per-phase verbs in design note §7.5 | A wrong label on evidence; a plural bug in four strings | — |
| D37 | Four type tokens (rem): `text-label` 11/16, `text-meta` 12/16, `text-body` 13/18, `text-title` 15/20. Anything carrying a value is at least `meta`. New and rewritten components use only these; other files migrate in a later codemod | About 357 literal sizes, 9–15 px, no scale | — |
| D38 | D13 is amended: the old `*Detail` panels are unmounted by Task 9 and deleted by Task 11, after Task 10's preview and sign-off | The checks and photos now live in the zones; keeping both would render each twice | D13 |
| D40 | `departureSealForLeg` takes the **immediately preceding** departure, then reads its seal, even when null. It no longer skips seal-less departures | The old filter returned an earlier leg's seal on a cross-dock leg whose own departure recorded none, so arrival compared against the wrong seal. The backend's `_find_departure_for_leg` (`phases/seals.py`) already takes the immediate predecessor | Existing helper (bug) |
| D41 | "Time on the road" = `(legArrivedAt ?? now) − legDepartedAt`. `legDepartedAt` = `legDepartureAt(allPhases, phase)`; `legArrivedAt` = the in_transit phase's own `completed_at` (the clock stops at arrival). When `legDepartedAt` is null the duration and "Departed {time}" are **omitted**, never guessed | The verdict needs both ends of the leg | — |
| D42 | `onOpenException(exceptionId: string \| null, phaseId: string \| null)`: a trip-level exception has no phase. "Show in timeline" for a row hidden by the cap of 3 reveals that row (the card shows it in place of the lowest-priority visible row, or opens the card) before scrolling to and highlighting it | Trip-level exceptions and capped rows must still be reachable both ways | D33 |
| D43 | Location is **two checks**, never merged: `truck_geofence` from `pulsit_geofence_confirmed` ("Truck within precinct tolerance" pass / "Truck outside precinct tolerance" flag / null → `not_checked` "Truck precinct check unavailable") and `driver_proximity` from `action_location_assessment.proximity` ("Driver with truck" `within_limit` pass / "Driver separated from truck" `separated` flag / `unverified` → `not_checked`). **No assessment recorded → no proximity line** (legacy rows), so older phases are not all marked unverified. A truck inside the precinct can never hide a separated or unverified driver | The evidence model records them separately (`location-evidence.ts`: `verdict` and `proximity`); one "Location verified" line overclaimed | Design note §4 "Which checks exist" |
| D44 | The `clean` outcome's visible word is **"Checks passed"** (the internal key stays `clean`) | It says what the evidence establishes, not a judgment about the phase | Design note §4 outcome words |
| D39 | D23 is extended: on a cancelled trip the unresolved phase's rows are visible when it has attributed uploads **or exceptions** | An en-route leg cancelled with exceptions must not lose them | D23 |

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
| `frontend/dispatcher/lib/phase/acts.ts` (new) | 8 | `buildPhaseActs` (adds `milestone`, `anchor`, `absent`) | — |
| `frontend/dispatcher/lib/phase/checks.ts`, `lib/phase/verdict.ts`, `lib/format/count.ts` (new) | 8b | `buildPhaseChecks`, `phaseVerdict`, `countLabel` | Dispatcher-only, no shared file |
| `frontend/dispatcher/components/domain/{PhaseActs,PhaseChecks,PhaseAudit,PhaseVerdictLine,ExceptionRow}.tsx` (new), `components/trips/PhaseTimelineItem.tsx`, `TripTimeline.tsx`, `components/domain/{EvidenceDocument,ExceptionSummary}.tsx`, `frontend/dispatcher/tailwind.config.ts`; delete `components/trips/PhaseExceptionGroup.tsx` (+ test) | 9 | zones, verdict, in-transit always open, forensic gating, exception rows replacing the group, type tokens | `tailwind.config.ts`: flag in PR (dispatcher-only) |
| `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`, `components/trips/{TripExceptionsPanel,TripDetailPanel}.tsx` | 9a | panel opens on one exception (`exception=<id>`) and shows supporting evidence | Owner unknown |
| `frontend/dispatcher/app/dev/design/page.tsx`, `components/domain/__fixtures__/phase-acts.ts` (new); delete `app/dev/design/_timeline-options/` | 10 | real-`TripTimeline` scenario previews; the throwaway option mockups go | Owner unknown |
| `frontend/dispatcher/components/domain/*Detail.tsx`, `PhaseEvidence.tsx`, `PhaseOverrideSection.tsx`, `PhaseAnchorSection.tsx` and their tests | 11 | delete the unmounted panels (re-scoped) | Owner unknown |

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

- [x] **Step 1: failing tests** — hook: `retake before the first upload resolves keeps the retake` (first resolves `null`), `unmount resolves null`, `attribution is forwarded`; api: `sends both attribution fields or neither`; phases: `fallback upload carries the phase and role`, `ready id skips the upload`, `queued replay uploads with attribution`; each step: `captures with this phase and the step's role`.
- [x] **Step 2:** run, expect FAIL.
- [x] **Step 3:** implement.
- [x] **Step 4:** driver-pwa `vitest run`, `tsc --noEmit`, `npm run lint`.
- [x] **Step 5:** stage; suggested commit `feat(driver-pwa): attribute captures to their phase and ignore superseded uploads`. Compatibility: an older APK keeps uploading unattributed and still completes (Task 4 accepts it).

### Task 7: Dispatcher refreshes only the resources an event changes

**Files:**
- Modify: `frontend/dispatcher/lib/realtime/types.ts` — add `'evidence_uploaded'`; `KIND_CHANGES_TRIP_RECORD: Record<RealtimeKind, boolean>` (`evidence_uploaded: false`, everything else `true`); derived `TRIP_RECORD_KINDS: readonly RealtimeKind[]`.
- Modify: `lib/hooks/useTripResource.ts` — `useTripResource<T>(tripId, suffix, initial, kinds?: readonly RealtimeKind[])` forwarded to `useLiveResource`.
- Modify: `useTripDetail.ts`, `useManifest.ts`, `useTrips.ts` pass `TRIP_RECORD_KINDS`; `useTripArtifacts.ts` passes nothing (all kinds).
- Test: `lib/hooks/__tests__/useTripResource.test.tsx`, `lib/realtime/ranking.test.ts`, a `useTrips` test (extend the existing one, or create `lib/hooks/__tests__/useTrips.test.tsx` if none exists).

- [x] **Step 1: failing tests** — `evidence_uploaded refreshes artifacts but not the trip record`; `phase_completed refreshes both`; `reconnect refreshes every filtered resource` (Review Focus 3); `live trip list ignores evidence_uploaded`; ranking: `evidence_uploaded raises no toast`.
- [x] **Steps 2–4:** fail, implement, dispatcher `vitest run` + `tsc --noEmit`.
- [x] **Step 5:** stage; suggested commit `feat(dispatcher): scope live refreshes by event kind`.

### Task 8: `buildPhaseActs`, the pure row model (Revision 4)

**Files:**
- Create: `frontend/dispatcher/lib/phase/acts.ts`, `frontend/dispatcher/lib/phase/acts.test.ts`
- Modify: `frontend/dispatcher/lib/phase/derive.ts` (`departureSealForLeg`, D40) and its test `frontend/dispatcher/lib/phase/derive.test.ts`. First a failing test: leg 1's departure has seal `A`, leg 2's departure has seal `null` → leg 2 returns `null`, not `A`. Then the fix: pick the last departure with `sequence_number` below the phase, then return its `seal_number`. Existing callers (`ArrivalDetail`, `UnloadingDetail`) get the corrected value too; their tests must stay green.

**Interfaces:**
```ts
export type EvidenceActState = 'uploaded' | 'submitted' | 'not_submitted' | 'after_close' | 'trip_cancelled'
export type EvidenceProvenance = 'driver' | 'receiver' | 'unknown'
export interface CompletionValues {
  sealNumber: string | null; sealCondition: SealCondition | null
  parcelsScanned: number | null; driverVisualCount: number | null
}
export type PhaseAct =
  | { kind: 'evidence'; key: string; role: EvidenceRole; artifactId: string
      provenance: EvidenceProvenance; state: EvidenceActState
      metadataAvailable: boolean; takenAt: string | null; receivedAt: string | null
      receivedAfterCancellation: boolean }
  | { kind: 'milestone'; key: string; event: 'departed'; at: string; sealNumber: string | null }   // in_transit only
  | { kind: 'completion'; key: string; outcome: 'completed' | 'exception' | 'overridden'
      confirmedAt: string | null; recordedAt: string; values: CompletionValues
      override: { note: string | null; authorisedBy: string | null } | null }
  | { kind: 'exception'; key: string; exceptionId: string; at: string }
  | { kind: 'absent'; key: string; role: EvidenceRole }                                  // resolved phases only (D35)
  | { kind: 'anchor'; key: string; status: 'pending' | 'anchored' | 'failed'; consensusAt: string | null }  // rendered in forensic mode only (D32)
  | { kind: 'expected'; key: string; role: EvidenceRole | null
      reason: 'evidence' | 'driver_confirmation' | 'warehouse_scan' | 'en_route' }
export interface PhaseActsInput {
  phase: PhaseDescriptor
  allPhases: readonly PhaseDescriptor[]     // leg-scoped departure time and seal (legDepartureAt, departureSealForLeg)
  isActive: boolean                         // phase_event_id === currentTripPhase(trip)?.phase_event_id
  tripStatus: TripStatus
  tripClosedAt: string | null               // set by cancel_trip and by closure
  artifacts: readonly EvidenceArtifactWithUrl[]
  exceptions: readonly TripException[]
  receipt: BlockchainReceipt | undefined
}
export function buildPhaseActs(input: PhaseActsInput): PhaseAct[]
export const RECEIVED_GAP_DISPLAY_MS = 120_000
```
`summarisePhaseActs` and `PhaseActSummary` are **removed**: the header verdict is built in Task 8b.

Rules (unchanged unless marked **new**):
- **Which artifacts:** every artifact attributed to this phase, plus every id the phase's role columns cite (`EVIDENCE_ROLE_FIELD`), whether or not it is in `artifacts`. A cited id missing from `artifacts` still yields a row with `metadataAvailable: false` and null times (D25).
- **Visibility:** resolved → rows always. Unresolved → rows when `isActive` on a running trip, **or** when `tripStatus === 'cancelled'` and the phase has at least one attributed upload **or exception** (D23, D39). Any other unresolved phase → `[]`. **in_transit follows the same rule** (it has no artifacts, so its rows are the milestone, exceptions, completion, anchor and expected rows).
- **State** (D24): resolved → `submitted` if cited; else `after_close` when `created_at > completed_at`, else `not_submitted` (overridden phases use the same rule). Unresolved on a cancelled trip → `trip_cancelled` with `receivedAfterCancellation = created_at > tripClosedAt`. Unresolved and active → `uploaded`. Capture order never sets state.
- **Provenance** (D8): `receiver` only when `evidence_role === 'pod_signature'` and `phase_event_id === phase.phase_event_id`; `driver` when `captured_by_driver_id` is set; otherwise `unknown`.
- **new, milestone:** for `in_transit` only, when `legDepartureAt(allPhases, phase)` is non-null: `at` = that time, `sealNumber` = `departureSealForLeg(allPhases, phase)` (leg-scoped: a cross-dock leg shows its own seal, or none when its own departure recorded none, D40).
- **Completion row** only when `completed_at` is set; **new:** `values` read from the phase row, `override` from `dispatcher_override_note` / `dispatcher_override_user_id` (null when neither is set). Exception rows use the existing `exceptionEventTime` rule, moved from `TripTimeline.tsx` into this module so both use one definition.
- **new, absent rows (D35):** only for a **resolved, non-overridden** phase, for each role the phase type has (`EVIDENCE_ROLES`, excluding `waybill_photo`) whose column is null **and** that has no attributed upload for the role. Never for an active or overridden phase, and never for activation, in_transit or unloading.
- **new, anchor row:** one `anchor` act when `phase.anchor_status !== 'not_required'` (`status` from `anchor_status`; `consensusAt` from `receipt.hedera_consensus_timestamp`). The builder always produces it; **the component shows it only in forensic mode** (Task 9).
- **Expected rows** only when `isActive` and the trip is not cancelled: one per role in `EVIDENCE_ROLES` (except `waybill_photo`) with no attributed upload and no cited id; then `driver_confirmation`; `warehouse_scan` instead when `phase.blocked_on === 'warehouse_scan'`. **new:** for `in_transit`, an `en_route` row first, then `driver_confirmation`.
- **Order:** event time ascending (`takenAt`, milestone `at`, `confirmedAt ?? recordedAt`, exception `at`; unknown times sort after known ones), ties by `key`. `absent` rows sit immediately before the completion row, the anchor row after it, expected rows last.

- [ ] **Step 1: failing tests** (the original cases stay)
  - normal completed departure (one submitted seal photo, completion row with the seal number in `values`).
  - two uploads for one role on the active phase → both `uploaded`, no "replaced"; after completion → `not_submitted` and `submitted` per the column, whatever their capture order.
  - upload after completion → `after_close`.
  - overridden phase with an upload → `not_submitted` or `after_close`; completion row `outcome: 'overridden'` with `override.note` and `authorisedBy`; **no `absent` rows**.
  - **cancelled trip**: the active phase's uploads appear as `trip_cancelled`, one flagged `receivedAfterCancellation`; no expected rows; a later pending phase returns `[]`. **new:** a cancelled trip's unresolved in_transit leg with two exceptions returns its milestone and both exception rows.
  - upload attributed to a future phase → not shown while pending.
  - **cited artifact missing from the list** → one row, `metadataAvailable: false`, null times, state `submitted` (Review Focus 5).
  - provenance: attributed `pod_signature` → `receiver`; unattributed id cited as `pod_signature` with no driver id → `unknown`; artifact with a driver id → `driver`.
  - receiver confirmed before the driver completes → receiver row plus expected `driver_confirmation`.
  - offline arrival (taken 14:04, received 14:41, confirmed 14:18 on device, recorded 14:41).
  - **expected rows never assert absence** (Review Focus 1: an unattributed upload exists; the row is still `expected`, no "missing" state exists in the type).
  - **device clock ahead of server** (Review Focus 2).
  - blocked on warehouse scan; exception ordered among photos by capture time.
  - **new, in_transit active:** milestone, exception rows in time order, `expected` `en_route` then `driver_confirmation`, no evidence/absent rows.
  - **new, in_transit resolved:** milestone, exceptions, completion, anchor; no expected rows. **in_transit pending → `[]`.**
  - **new, cross-dock:** two legs return their own departure time and seal, not each other's; **leg 2's departure with a null seal gives a milestone with `sealNumber: null`, not leg 1's seal** (D40).
  - **new, absent:** resolved departure with a null seal photo and no attributed upload → one `absent` for `seal_photo`; with an attributed-but-uncited upload → no `absent` (it is a `not_submitted` row); active departure → none; resolved unloading → none.
  - **new, anchor:** `pending`, `anchored` (with `consensusAt`), `failed`; `not_required` → no anchor act.
- [ ] **Steps 2–4:** fail, implement, `vitest run lib/phase/acts.test.ts`.
- [ ] **Step 5:** stage; suggested commit `feat(dispatcher): derive each phase's recorded rows`.

### Task 8b: Checks, verdict and the plural helper (new)

**Files:**
- Create: `frontend/dispatcher/lib/phase/checks.ts`, `lib/phase/verdict.ts`, `lib/format/count.ts` and a `.test.ts` for each.

Moves the check logic that today lives inside `LoadingDetail`, `UnloadingDetail`, `ArrivalDetail` (`sealFindings`) and `ConfirmationDetail` into one pure module. **The panels keep their own copies until Task 11 deletes them** (temporary duplication, accepted: the panels are unmounted by Task 9).

**Interfaces:**
```ts
export type CheckKey = 'truck_geofence' | 'driver_proximity' | 'parcels' | 'counts' | 'seal_number' | 'seal_condition' | 'seal_inspection' | 'bypassed'
export type CheckResult = 'pass' | 'flag' | 'not_checked' | 'in_progress'
export interface PhaseCheck { key: CheckKey; result: CheckResult; title: string; detail: string }
export interface PhaseChecksInput {
  phase: PhaseDescriptor; allPhases: readonly PhaseDescriptor[]
  expectedCount: number | null; liveScannedCount: number | null; originScannedCount: number | null
  precinct: Precinct | undefined
}
export function buildPhaseChecks(input: PhaseChecksInput): PhaseCheck[]       // [] for an unresolved phase except live scan lines (in_progress)

export type PhaseOutcome = 'overridden' | 'attention' | 'reviewed' | 'unverified' | 'clean' | 'in_progress' | 'current'
export interface PhaseVerdict { outcome: PhaseOutcome; headline: string; reasons: readonly string[]; nodeType: PhaseNodeType }
export interface PhaseVerdictInput {
  phase: PhaseDescriptor; checks: readonly PhaseCheck[]; exceptions: readonly TripException[]
  actCounts: { uploads: number }; isActive: boolean; tripStatus: TripStatus
  leg: { departedAt: string | null; arrivedAt: string | null } | null   // in_transit only (D41): legDepartureAt(allPhases, phase), phase.completed_at
  nowMs: number                                                          // only for an unfinished leg's "time on the road"
}
export function phaseVerdict(input: PhaseVerdictInput): PhaseVerdict | null   // null for trip_creation and for an unresolved phase on a cancelled trip

// lib/format/count.ts
export function countLabel(n: number, singular: string, plural?: string): string   // countLabel(1, 'parcel') → "1 parcel"; (0|2, 'parcel') → "0 parcels"
```
Rules: the check table is design note §4 ("Which checks exist") and §7.2; the verdict rules are design note §4 and D29. Wording constants live in one place. The anchor state is **not** an input. The `clean` outcome's headline is "Checks passed" (D44). Location is two checks (D43). `phaseVerdict` for an active in_transit leg reads "{n} exceptions en route, {m} need review · Departed {time} · {h} h {mm} m on the road" (labelled clock, D16; duration per D41, omitted with "Departed" when the departure time is unknown); for a finished leg without exceptions it is `unverified` with "No exceptions recorded" and **never** `clean` (D29).

- [ ] **Step 1: failing tests**
  - every outcome, and the precedence `overridden > attention > reviewed > unverified > clean > in_progress`; `current` for an active phase with no uploads.
  - **an unreviewed critical exception on a running phase outranks `in_progress`.**
  - parcels: 7/7 pass; 7/6 flag "1 parcel unaccounted for" (plural: 2 → "2 parcels unaccounted for"; excess: "1 excess parcel"); null baseline → `not_checked`, not zero.
  - seal: same number + intact → two passes; different numbers with no exception → `flag` (O8); condition `damaged`/`missing` → `flag`; no departure seal for the leg → `not_checked`; cross-dock uses the leg's own departure seal.
  - truck geofence (D43): `true` → pass "Truck within precinct tolerance"; `false` → flag; null → `not_checked` → outcome `unverified`, never `clean`.
  - driver proximity (D43): `within_limit` pass; `separated` flag → `attention`; `unverified` → `not_checked` → `unverified`; **no assessment → no proximity check at all** (a legacy phase with a passing geofence and no assessment can still be `clean`); **truck inside the precinct + driver `separated` → `attention`, never `clean`**.
  - `clean` headline reads "Checks passed"; the word "Clean" appears nowhere (D44).
  - time on the road (D41): active leg departed 09:00, now 12:12 → "3 h 12 m on the road"; resolved leg uses `completed_at`, not now; `departedAt` null → no duration and no "Departed"; the string never shows a negative or NaN duration.
  - overridden phase → one `not_checked` "Checks bypassed" and outcome `overridden`.
  - in_transit: no `pass` is ever produced; resolved with no exceptions → `unverified` "No exceptions recorded"; with all exceptions reviewed → `reviewed`; active with one unreviewed → `attention`.
  - **an anchor `failed` phase with clean checks is still `clean`** (anchor is not an input).
  - unresolved phase: no `pass`/`flag`; Loading/Unloading give `in_progress` scan lines only.
  - `nodeType` is `warn` for every `attention`, including a phase with `status = completed` and a flagged check (the Confirmation 7→6 case).
  - null for trip_creation and for an unresolved phase on a cancelled trip.
- [ ] **Steps 2–4:** fail, implement, `vitest run lib/phase lib/format`, `tsc --noEmit`.
- [ ] **Step 5:** stage; suggested commit `feat(dispatcher): derive each phase's checks and verdict`.

### Task 9a: The exceptions panel can open on one exception (new, Revision 5; was the panel half of 9b)

Panel side only. The timeline does not change in this task, so every commit renders each exception once.

**Files:**
- Modify: `frontend/dispatcher/app/(app)/trips/[id]/page.tsx`, `components/trips/TripExceptionsPanel.tsx`, `components/trips/TripDetailPanel.tsx`.

**What it does:**
- A new `exception=<id>` URL parameter beside the existing `panel=exceptions&phase=<id>`. `setPanel` gains an optional exception id. The panel opens on that record, scrolls to it and marks it selected. Docked at ≥ 1280 px (`DetailPanel`); below that the same call raises the modal. An `exception` id not on the trip shows a recoverable message, like the existing invalid-phase one.
- **"Supporting evidence"** (position disagreement, supporting photo) is added to the panel's exception footer: today it exists only in the timeline card's footer, so Task 9's removal of those cards would otherwise drop it. `TripDetailPanel` passes `artifactsById`.
- Exposes the callback Task 9's rows will call: `onOpenException(exceptionId: string | null, phaseId: string | null)` (D42): exception id `null` = open the panel filtered to the phase, for "+n more"; phase id `null` = a trip-level exception (no phase filter).

- [ ] **Step 1: failing tests**
  - `exception=<id>` opens the panel on that record, scrolled to and marked selected; a reload of that URL does the same.
  - docked (≥ 1280) and overlay (< 1280) both open from a call to `onOpenException`.
  - a trip-level exception (`phaseId: null`) opens the panel on that record with no phase filter.
  - supporting evidence renders in the panel for a `gps_mismatch` and for an exception with a supporting photo.
  - an unknown `exception` id shows the recoverable message; `phase=` filtering and batch review still work.
- [ ] **Steps 2–4:** fail, implement, dispatcher `vitest run`, `tsc --noEmit`, `npm run lint`.
- [ ] **Step 5:** stage; suggested commit `feat(dispatcher): open the exceptions panel on one exception`.

### Task 9: The card: verdict, three zones, exception rows, forensic gating (Revisions 4–5; detail panels unmounted)

Depends on 8, 8b and 9a. Build in this order, so that if time runs out only the last step is dropped: (1) verdict line and the **stacked** zones for every phase type; (2) exception rows replacing `PhaseExceptionGroup`; (3) in-transit always open; (4) forensic gating; (5) **last**, the side-by-side split (D30). The split is the only droppable part: without it every card renders stacked, which is what 1280 (panel docked) and 768 show anyway. The honesty rules (D15, D24, D29, D34, D35) are never dropped.

**Files:**
- Create: `frontend/dispatcher/components/domain/PhaseActs.tsx` (Recorded), `PhaseChecks.tsx` (Checked), `PhaseAudit.tsx` (Audit trail, forensic), `PhaseVerdictLine.tsx`, `ExceptionRow.tsx` (+ tests under `components/domain/__tests__/`).
- Modify: `components/trips/PhaseTimelineItem.tsx` (a `verdict` slot replaces `summary` and `evidenceSummary`; `alwaysOpen` extends to in_transit active **and** resolved; node colour from the verdict), `components/trips/TripTimeline.tsx`, `components/domain/EvidenceDocument.tsx` (style the Retry button), `components/domain/ExceptionSummary.tsx` (drop `onOpenPanel` if nothing else uses it), `frontend/dispatcher/tailwind.config.ts` (`theme.extend.fontSize`: the four tokens of D37).
- Delete: `components/trips/PhaseExceptionGroup.tsx` and `PhaseExceptionGroup.test.tsx`; rewrite the group cases in `TripTimeline.test.tsx` for the row.
- Reuse unchanged: `EvidencePhoto`, `EvidenceDocument`, `PhaseLocationSection` / `LocationEvidencePanel` (inside "Location details"), `InTransitArrivalLocation`, `PhaseOverrideAction`, `TripCreatedDetail`, `ForensicOnly`, `ChainReceiptTag`, `VerifyButton`, `CurrentLegStrip`, `useNow`.

**What it does** (the content contract is design note §7; the inventory is design note §2):
- Per phase, `TripTimeline` computes `buildPhaseActs`, `buildPhaseChecks` and `phaseVerdict`, and renders `PhaseTimelineItem` with the verdict line in the header (icon + word + reasons, never colour alone) and the zones as its body. `PhaseEvidence` and the `*Detail` panels are no longer mounted (except `TripCreatedDetail` for trip_creation); `PhaseOverrideAction` stays below the zones.
- **Recorded** (`PhaseActs`): evidence rows through `EvidencePhoto` / `EvidenceDocument` (so "Recorded artifact unavailable" and "Evidence lookup failed" come from the existing components), receiver wording by provenance (D8, D36), milestone, completion (with recorded values, the override note and "Authorised by"), exception rows, `absent` rows, expected rows, and **the anchor row inside `ForensicOnly`**. Several uploads for one role group under "{n} photos uploaded" and collapse beyond the first with "+{n − 1} more". New rows highlight only when `live`.
- **Checked** (`PhaseChecks`): one line per check with icon and words; raw fixes behind "Location details"; the standing in-transit lines; "Checks appear when the driver confirms {phase}" before completion.
- **Audit trail** (`PhaseAudit`): the whole zone inside `ForensicOnly`: receipt tag, event hash (the `CopyField` from `PhaseAnchorSection`), `VerifyButton`. With forensic mode off the zone is not rendered.
- **Exception rows (D33):** `ExceptionRow` is one component: type, severity chip, time, source, review state, two-line description; the whole row is a `<button>` with an `aria-label` that calls Task 9a's `onOpenException(exceptionId, phaseId)`. A collapsible card shows its rows (max 3, then a "+n more · Open in exceptions panel" row calling `onOpenException(null, phaseId)`) under the verdict while collapsed, and in the rail when open, never both. The same component renders the trip-level "Trip record" list. **`PhaseExceptionGroup` is removed in this same task**, so exceptions are never rendered twice. **"Show in timeline"** (panel to timeline) is re-pointed from the group to the row: open the phase card if collapsed, scroll to the row, highlight it for the existing 1.4 s, on both the docked path and the overlay-then-reveal path. Closing the overlay returns focus to the row that opened it.
- **In-transit (D31):** active or resolved → open, no toggle, no chevron; not started → collapsed "Not started". "Time on the road" ticks with the existing `useNow` hook (`lib/hooks/useNow.ts`) at one minute.
- **Layout (D30), last step:** a `ResizeObserver` on the card body picks side by side (≥ `SPLIT_MIN_PX = 740`, ≥ 1 check, not in_transit) or stacked. Not a viewport query.
- **Type scale (D37):** the four tokens in `tailwind.config.ts`; the new components use only them. Open item O1 (white exception cards) is not decided here: build the row so the card treatment is one class string.

- [ ] **Step 1: failing tests**
  - **Nothing lost (design note §2):** one assertion per inventory row whose new home is a zone, against an opened resolved card of that phase type, so unmounting the panels cannot silently drop a field. At least: activation precinct, address and slot time (in "Location details"); loading expected vs scanned; departure seal number; arrival seal read, condition and this leg's departure seal; unloading scanned off vs expected and the "Scan in progress" note while unresolved; confirmation scanned out / in and the counts line; the driver's blind count and its "Counted blind" note; the location verdict line, and in "Location details" the driver and tracker fixes, capture times, separation, boundary and "View on map"; the override note and "Authorised by"; the in-transit "Only recorded journey events are shown" absence and the recorded arrival location; with forensic on, the receipt tag, event hash and Verify. The three intentional drops (activation "Arrived", "No seal present" on an unresolved phase, `PhaseAnchorSection`'s status and warning) are asserted absent.
  - verdict line per outcome (icon, word, reasons); header answers "clean?" with the card collapsed.
  - Recorded/Checked/Audit order; **with forensic mode off no anchor row, no Audit trail, no receipt/hash/Verify; "Anchor failed — receipt still owed" still shows; with forensic on they appear.**
  - **in_transit active and resolved are open with no toggle and no `aria-expanded` button; in_transit not started is collapsed; every other resolved phase is collapsed by default.**
  - **content per phase type exactly as design note §7.2:** no photo or "Expected: photo" row on activation, in_transit or unloading; `absent` row on a resolved departure with no cited photo; none on an active one.
  - wording per row kind and state (D24); device/server labels (D16); "Receiver confirmed delivery · Attestation image" only for `receiver` provenance, "Submitted as receiver confirmation" otherwise; the string "Ed25519" appears nowhere.
  - `groups several uploads for one role` (Review Focus 4); highlight only when live.
  - exception rows render once (collapsed: under the header; open: in the rail), cap 3 + "+n more", click calls `onOpenException`, keyboard (Enter/Space) works; the row never renders the full card; `PhaseExceptionGroup` is gone.
  - "Show in timeline" opens a collapsed card, scrolls to and highlights the row, docked and overlay; closing the overlay returns focus to the row.
  - **"Show in timeline" for the 5th of 6 exceptions (hidden by the cap) reveals that row, then scrolls to and highlights it** (D42); for a trip-level exception it targets the "Trip record" row.
  - Checked shows the truck geofence and driver proximity as separate lines (D43); no "Location verified" string.
  - amber node for `attention` with `status = completed` and a flagged check.
  - **a submitted photo whose metadata failed to load still shows "Recorded artifact unavailable"** (Review Focus 5); **a cancelled trip shows the unfinished phase's uploads and exceptions with no waiting rows and no highlight**; a resolved phase receiving a late upload or an anchor receipt updates with no live styling; a 13-phase cross-dock renders one current card and every in_transit leg open.
  - split layout only at ≥ 740 px with a check and not in_transit (stub `ResizeObserver` at 772, 676, 564 px); in_transit stacked at any width. (Dropped with the split if step 5 is cut.)
  - type tokens only: a test reads the new files and fails on `text-\[\d+px\]`.
- [ ] **Steps 2–4:** fail, implement in the order above, dispatcher `vitest run`, `tsc --noEmit`, `npm run lint`.
- [ ] **Step 5:** stage; suggested commit `feat(dispatcher): verdict header, three-zone phase cards and exception rows`.

### Task 10: Preview the hard cases on the real timeline (Revision 4)

**Files:**
- Create: `frontend/dispatcher/components/domain/__fixtures__/phase-acts.ts` (name kept): scenarios built from `makePhasePlan` (`shared/lib/mocks/phase-trips.ts`).
- Modify: `frontend/dispatcher/app/dev/design/page.tsx`: a "Trip timeline scenarios" section rendering the **real `TripTimeline`** (and the real `TripExceptionsPanel`) per scenario, with controls for width (1440, 1280, 1024, 768), forensic mode (on/off, through `ForensicModeContext`) and panel (docked ≥ 1280, overlay below).
- Delete: `frontend/dispatcher/app/dev/design/_timeline-options/` and its import and element in `page.tsx`.
- Real images: the local artifacts endpoint fails, so the fixtures carry `EvidenceArtifactWithUrl` entries whose `signed_url` points at real JPEGs (portrait and landscape, a dark low-contrast seal photo) under `frontend/dispatcher/public/dev-fixtures/`; add a scenario with a 400-character exception description and one with a long precinct name.

Scenarios: normal single-leg trip; 13-phase cross-dock mid-trip with three in_transit legs (each open); **in_transit active with a critical exception**; **in_transit resolved with no exceptions ("No exceptions recorded")**; in_transit resolved with a reviewed deviation; offline arrival; three seal uploads on the active phase; tracker dark (`unverified`); **a failed parcel count with no exception (amber node)**; **cancelled mid-phase with uploads, and a cancelled en-route leg with exceptions**; **submitted evidence whose metadata is unavailable**; **a resolved phase with a missing submitted photo (`absent`)**; **overridden phase**; anchor pending and anchor failed; unattributed signature (neutral wording); **a phase with 15 exceptions (cap)**.

- [ ] **Step 1:** add fixtures and the section; delete the throwaway mockups.
- [ ] **Step 2:** start the dispatcher preview, open `/dev/design`. For each scenario check at 1440, 1280, 1024 and 768, forensic off and on: read the page for wording against design note §7.2 (the right things in the right phases), that no anchor row or audit trail appears with forensic off, that every in_transit leg is open, that C splits only where it should (772 px) and stacks at 676 and 564 px, that an exception row opens the panel (docked and overlay), and that "Show in timeline" returns to the row. There is no dark theme and no mobile layout to check. Screenshot the cross-dock, the cancelled en-route, the unavailable-evidence, the 15-exception and the in-transit cases for the PR.
- [ ] **Step 2b:** repeat the 1280 and 768 checks at 200 % browser zoom: nothing clips, thumbnails stay recognisable, rows still read in order.
- [ ] **Step 3:** Ciaran reviews the screenshots and decides: the white exception cards (O1), the exception cap (O5), the completion verbs (O4), and that the zones can replace the panels.
- [ ] **Step 4:** stage; suggested commit `chore(dispatcher): timeline scenarios on the dev design page`.

### Task 10b: Revision after the live review (Revision 6, 13 Oct)

Why: Tasks 8–10 match the design note, but a real completed trip (`FP-20261001-32FF7346`, History, 16 exceptions across 7 phases) showed four problems the fixtures hid, and a review found a fifth (exceptions linked to trip_creation render nowhere). (1) Collapsed cards were a wall of full exception cards, barely shorter than open ones, and showed only exceptions, not what happened. (2) Findings raised *by* a handshake (e.g. the separation check run when the driver taps "arrived") render as separate events *after* the completion row, and in_transit calls them "en route". (3) "Location details" repeats the coordinates the map modal already shows. (4) Every card on that trip is amber, so the tint carries no information. Depends on 10. Task 11 waits for this.

Out of scope (separate tasks, ask first): cross-dock parcel-count check, `legDepartureAt` skip-unfinished-departure bug, live pulse (`nodeTypeFor` never returns `active`), "Authorised by" name lookup, repeated identical findings across handshakes, the pending `ciaran_artifact_attribution` migration on the shared dev DB (photos on real trips show "Evidence lookup failed" until it reaches `dev`). Backend and `frontend/shared` are not touched.

**Decisions**
- **D45 — Collapsed card = compact rail.** A collapsed, resolved, non-transit card shows its acts from `buildPhaseActs` as one line each, in time order: time · icon · short label (e.g. `12:29  Driver confirmed loading · 16 parcels`, `12:29  Linehaul sheet photographed`, `12:29  ⚠ Driver separated from truck · Warning · Needs review`). No descriptions, thumbnails, values grid or links. An exception line is a `<button>` that calls `onOpenException(id, phaseId)`, the cap of 3 + "+n more" still applies to exception lines. Anchor rows are omitted (forensic, open card only). **Compact does not mean less honest:** a compact evidence line keeps its state (uploaded, submitted at completion, not submitted / `absent`, received after closure, trip cancelled) and its provenance wording (receiver vs driver vs unattributed, D8/D36); a time the record does not carry stays an explicit "Time unavailable", never blank or borrowed; device and server times keep their clock label (D16) — compact may abbreviate it ("device", "server") but must not drop it. Several uploads for one role are **one** compact line ("Seal · 3 photos uploaded"), as in the full rail's grouping. **A manually collapsed active card** (non-transit phases keep their toggle) shows the same compact rail including `expected` lines ("Waiting: seal photo") with the same wording as the full rail, and no live highlight. The open card is the full-detail rail plus Checked and Audit, unchanged. This supersedes the "exception rows under the verdict" half of D33; the exceptions-never-hidden rule still holds because exception lines are in the compact rail. trip_creation keeps its card (no compact rail of acts), **but exceptions linked to the trip_creation phase must render**: today `buildPhaseCardModel` returns `EMPTY_MODEL` for it (`lib/phase/card.ts:90`) while `TripTimeline` still routes those exceptions to that phase, so they show nowhere. Fix: the trip_creation model carries its exception rows (no verdict, no checks); they render as compact exception lines when collapsed and above `TripCreatedDetail` when open. This is a regression from Task 9 and is fixed before the information-preservation claim stands. in_transit is always open (D31), so it never shows the compact rail.
- **D46 — Handshake findings attach to the completion.** An exception is a *handshake finding* when `source === 'system'`, `checkpoint_id === null`, `phase_event_id === phase.phase_event_id` and its type is in `HANDSHAKE_FINDING_TYPES` = `driver_vehicle_separation`, `driver_location_mismatch`, `gps_mismatch`, `trailer_location_mismatch`, `seal_mismatch`, `seal_unverified`, `seal_compromised`, `parcel_count_mismatch` (backend: `phases/completion.py` `_finish_phase` and `phases/findings.py`; comment the source). `ExceptionAct` gains `trigger: 'handshake' | 'override' | 'event'`. Handshake acts sort immediately after their completion act regardless of timestamp (the server stamps them a moment after the tap) and render indented under it, headed "Checked at this confirmation". **Overrides are not checks:** `phases/override.py:103-117` raises a system `seal_unverified` on an overridden Arrival *because* the seal check was skipped. On a phase with `status === 'overridden'`, a matching finding gets `trigger: 'override'` and groups under the override completion, headed "Recorded with this override" — never "Checked". **No completion, no grouping:** if the phase has no completion act (unresolved, cancelled), a would-be handshake finding stays a standalone `event` act in time order. Everything else (`trailer_separated_in_transit`, `tracker_silent`, driver-raised, checkpoint-raised) stays an `event` act in time order — these are the ones that can really happen between Departed and Arrived.
- **D47 — In-transit wording.** The in-transit completion reads **"Reached {destination}"** (the Arrival phase already says "Driver confirmed arrival"; two "arrived" rows read as two arrivals). The verdict counts only `event` exceptions as "en route"; handshake findings read "{n} at arrival check". Header meta is the leg, "{origin} → {destination}", and the verdict includes "Departed {HH:MM}" (design note §6, missed in Task 9).
- **D48 — Coordinates live in the map modal only.** "Location details" keeps: driver–truck separation, truck precinct check, driver proximity, the boundary and policy, capture times, "View on map". It drops the two coordinate pairs; the map modal keeps them. **Timeline-only:** `PhaseLocationSection` / `LocationEvidencePanel` are also used by `ExceptionDetailEvidence`, `ExceptionMapButton`, `PositionDisagreement` and others, so add a prop (e.g. `showCoordinates`, default `true`) and pass `false` only from `PhaseLocationDetails`. No other surface changes. Fix the stray icon overlapping the modal title (check whether that icon is shared before changing it).
- **D49 — Neutral cards.** `PhaseTimelineItem` card background for `warn` becomes the `done` surface; amber stays on the node and the verdict line only (matches the option-a reference). One class map change.

**Files:** modify `lib/phase/acts.ts` (+test: `trigger`, ordering), `lib/phase/act-wording.ts` (+test: "Reached"), `lib/phase/verdict.ts` (+test: en route vs at arrival check, "Departed"), `components/domain/PhaseActs.tsx` + `PhaseActRow.tsx` (a `density: 'compact' | 'full'` prop; handshake group under the completion), `components/trips/TimelinePhase.tsx` (collapsed content = compact `PhaseActs`; transit header meta), `components/trips/PhaseTimelineItem.tsx` (D49), `components/domain/PhaseLocationSection.tsx` / `PhaseLocationDetails.tsx` (D48, prop only), `lib/phase/card.ts` + `lib/phase/exception-rows.ts` (trip_creation exceptions), `components/domain/ExceptionRow.tsx` (defect 1), the duration formatter or its call site (defect 3), `app/(app)/trips/[id]/page.tsx` (error banner), `_timeline-scenarios` fixtures. `ExceptionRowList` stays for the trip-level "Trip record" list, which gets the same cap (O5). Its "+n more" opens the exceptions panel on **all trip-level records** (not a phase filter); if the panel has no trip-level filter today, stop and ask before adding one. "Show in timeline" for a capped trip-level record reveals that row (D42 applies to the trip list too).

**Also in this task (defects from Task 10):** `line-clamp-2` overridden by `block` in `ExceptionRow`; header time/title overlap and "Recorded artifact unavailable" Retry clipping at ~300 px card width (check at 320 CSS px); "1 h 35 m" wrapping — keep **only the duration phrase** together (non-breaking spaces inside the formatted duration, or `whitespace-nowrap` on that span). `NumericText` renders whole sentences, so it must not turn every space non-breaking: descriptions and verdict sentences wrap normally; evidence row label "Submitted at completion / Time unavailable" squeezed onto three lines in the narrow split column; the evidence-refresh error banner shows the raw API URL — show "Evidence could not be refreshed." + Retry, log the URL to the console.

- [ ] **Step 1: failing tests**
  - collapsed resolved loading card renders compact lines in time order (completion, photo, exceptions) and no description text; open renders full rows; the same exception never renders twice.
  - compact evidence lines: "submitted at completion", `absent` ("not submitted"), "received after closure" and receiver-provenance wording each render distinctly; a missing time renders "Time unavailable"; device and server times both carry a clock label; three seal uploads render one "3 photos" line.
  - a manually collapsed **active** card shows compact `expected` lines with the full rail's wording and no highlight.
  - an exception linked to the trip_creation phase renders on the Trip Created card (collapsed and open) and nowhere else.
  - compact exception line is a button, Enter/Space opens the panel; cap 3 + "+n more" on compact lines; "Show in timeline" for a capped row still reveals it (D42).
  - a `driver_vehicle_separation` with `checkpoint_id: null` on the phase sorts directly after completion even when its `at` is later than the next act; a `tracker_silent` stays in time order; a checkpoint-raised separation (`checkpoint_id` set) is `event`; a system `seal_unverified` on an **overridden** Arrival is `override`, groups under the override and the text "Checked at this confirmation" does not appear; a handshake-type finding on a phase with no completion (cancelled mid-phase) is a standalone `event` row.
  - in_transit: completion reads "Reached Johannesburg Depot (Linbro)"; verdict with one handshake finding says "1 at arrival check", not "en route"; header meta "Cape Town Depot (Epping) → Johannesburg Depot (Linbro)"; verdict contains "Departed".
  - timeline "Location details" contains no coordinate text (`/-?\d+\.\d{4,}, -?\d+\.\d{4,}/`); the modal does; `PhaseLocationSection` with no `showCoordinates` prop still renders coordinates (other surfaces unchanged).
  - `warn` card has no `bg-warn-c` class; node and verdict still amber.
  - `ExceptionRow` description has `line-clamp-2` without `block`; a formatted duration ("1 h 35 m") contains no breakable space, while a `NumericText` sentence still contains ordinary spaces.
  - trip-level list capped at 3 + "+n more"; "+n more" opens the panel on all trip-level records; "Show in timeline" for the 5th trip-level record reveals and highlights it.
- [ ] **Step 2:** implement; dispatcher `vitest run`, `tsc --noEmit`, `npm run lint`.
- [ ] **Step 3:** add a scenario "Handshake findings on every phase" mirroring the live trip (separation + outside-precinct on each handshake, one on in_transit completion). Check on `/dev/design` at 1440, 1024, 768 and 320 CSS px, forensic off and on; screenshot collapsed and open for that scenario, the 15-exception one and in-transit. If the migration has reached the dev DB by then, also check `FP-20261001-32FF7346` live.
- [ ] **Step 4:** stage; suggested commit `feat(dispatcher): compact collapsed rail and handshake findings under their confirmation`.

### Task 11: Delete the unmounted detail panels (re-scoped; re-plan after Task 10)

The old text of this task ("move photos out of the detail panels") is superseded: Task 9 unmounts `PhaseEvidence` and the `*Detail` panels, so photos and checks already render once. After Task 10's sign-off this task **deletes the dead code** (`LoadingDetail`, `DepartureDetail`, `ArrivalDetail`, `UnloadingDetail`, `ConfirmationDetail`, `ActivationDetail`, `PhaseEvidence`, `PhaseOverrideSection`, `PhaseAnchorSection`, and their tests, keeping anything Task 9 reused) and removes the duplicated check logic so `lib/phase/checks.ts` is the only copy. Re-plan it from the code as it stands after Task 10; do not start from the earlier text. Test: `TripTimeline` renders each submitted artifact and each check exactly once.

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
10. Receiver confirms before the driver completes: "Receiver confirmed delivery · {time} (server time)" appears live on the active confirmation card, followed by "Waiting for the driver to confirm delivery".
11. Anchor delayed: with forensic mode **on**, the completed card shows "Anchoring pending" with no live styling, then "Anchored {time}" when polling picks up the receipt. With forensic mode off nothing about anchoring is shown (an anchor `failed` still shows "Anchor failed — receipt still owed").
12. Uploads never refetch the trip record, the manifest or the trip list; the artifacts resource refetches once per burst.
13. Tracker dark: the Checked truck line reads "Truck precinct check unavailable" and the header reads "Not fully verified", never "Checks passed"; no photo row carries a location claim.
14. Artifacts request fails: every submitted photo still shows as recorded with "Evidence lookup failed" and a retry, nothing disappears.
15. Two identical uploads race on separate connections: one row, one event, both callers get the same id.
16. Forensic mode off: no anchor row, no audit trail, no receipt, hash or Verify on any phase. Forensic mode on: they appear on every anchored phase.
17. The in-transit card is open, with no toggle, while the leg is on the road and after it has finished, on every leg of a cross-dock trip; a leg not yet started is a collapsed "Not started" card.
18. An exception row on any phase opens that exception in the exceptions panel (docked at ≥ 1280 px, overlay below); "Show in timeline" returns to the row; the timeline renders each exception once and no full exception card.
19. A resolved phase with no submitted seal photo reads "No seal photo submitted at completion"; an active phase reads "Expected: seal photo".
20. A phase that failed a check without raising an exception (parcel count 7 vs 6) has an amber node and a "Needs attention" header; a phase with a dark tracker reads "Not fully verified", never "Checks passed". A truck inside the precinct with the driver separated reads "Needs attention".
21. Layout: a 772 px card with checks splits Recorded and Checked; the same card at 676 px (panel docked) and 564 px stacks; an in-transit card never splits.


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
- Revision 4 open items (design note §9): the white exception cards (O1), whether "Anchor failed" and the override's "Authorised by" stay visible outside forensic mode (O2, O3), the completion verbs (O4), the exception cap and whether in-transit needs a higher one (O5), the in-transit "No location verdict" line missing from the mockups (O6), the neutral "No exceptions recorded" wording (O7), flagging two differing seal numbers (O8), and the `exception=<id>` parameter name (O9).
- `render-attestation.ts` bakes "Swipe attestation taken on the driver's device" into the hashed receiver image; whether that text is wrong needs Tim (design note §10).
