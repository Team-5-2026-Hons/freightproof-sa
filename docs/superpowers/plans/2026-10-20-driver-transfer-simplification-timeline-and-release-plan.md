# FP-83 — driver transfer simplification, timeline and release plan

**Prepared:** 20 October 2026. **Submission:** 23 October 2026 (confirmed by Ciaran in this chat). **Status:** proposal for the next work sessions; no product changes authorised or made by this document. **Recommended feature freeze:** start of 22 October, followed by acceptance testing and submission preparation. The team must agree a clock time and test participants; the date is a recommendation, not a user-confirmed freeze.

**Review amendment, 20 October:** READY WITH AMENDMENTS. This document is the design/release brief. The companion [executable implementation plan](2026-10-20-driver-transfer-safety-and-simplification-implementation.md) translates it into ordered tasks, interfaces, regressions and handoff instructions. Read both in a fresh chat. The six review amendments are incorporated below; implementation is not authorised by this documentation edit. Dates are targets until named owners estimate the dependency chain and agree the gates. No fresh product test run is claimed here.

## Handoff for a fresh session

Read CLAUDE.md in full. FP-83 is implemented on merged dev at `f5c5c0b4`; current Ciaran HEAD `cc8f20da` includes that merge plus documentation. Source differences from the reviewed merge in backend/frontend/contracts are empty at this planning checkpoint. The user approved immediate-only requests without planning fields, with dispatcher authorisation followed by incoming-driver acceptance; outgoing A receives notices without a required confirmation or phone observation. The dispatcher entry belongs in the existing header driver cell without additional height, and the completed transfer belongs at its chronological position in the existing timeline. This plan proposes an immediate transfer-request workflow, twelve review repairs, and a 22 October acceptance gate before 23 October submission. Do not rewrite Trip.driver_id, completed records, old commitments or recorded custody. This is a planning handoff, not permission to commit, merge, push, read secrets, upgrade a shared database, or silently enable transfers. Implement only the stage subsequently requested by the user.

**Evidence baseline:** the earlier chat review reported dispatcher 2,951 passes, driver 1,440 passes/87 failures/one unhandled error, driver build/type check passing, 510 focused backend checks passing with a fixture failure and two PG14 analytics setup errors. These are dated review results, not fresh checks in this planning turn. The temporary review report is no longer present; the twelve findings are preserved below. The driver validation document still marks T2/T3 tests and real-client/native integration unfinished and must be updated from actual evidence.

**User decisions confirmed later on 20 October:** immediate-only requests are approved. For new v2 requests, the dispatcher authorises the substitution and B accepts; A is notified and must not be required to confirm. New events must occupy their chronological position in the existing timeline (for example Loading → Driver transferred → Departure), replacing the previously proposed top-of-timeline section. Keep B's existing vehicle/seal evidence and eligibility checks; removing those was not requested. Legacy v1 pending requests and recorded declarations retain their old rules. Product implementation remains for the new chat.

## Decisions and proposed refinements

### User requirements

- Remove planned point/time/toggle inputs from new immediate requests. Dispatcher authorises; incoming B accepts and records their own phone observation. Outgoing A is notified only; do not ask A for a confirmation/location or fabricate one. Preserve both declarations wherever actually recorded on legacy v1 requests.
- Put Transfer driver beside the current driver in the dispatcher trip header, using the existing space instead of a new row or sidebar entry.
- Decide whether to retain the feature before submission on 23 October, based on actual tests.
- Record each completed substitution as its own unnumbered event in chronological position among the existing phase cards, without making it a phase or exception. User example: if completed after Loading, show Loading → Driver transferred → Departure. Preserve existing phase cards and behaviour.

### Recommended submission scope

For new v2 requests use **Dispatcher authorises → B accepts takeover → server completes → B continues the same trip**. A receives durable request/completion notices; acknowledgement, connection and a fresh phone location from A are not completion gates. Until server completion A retains current access and B has pending-collection access only. B keeps the existing vehicle/seal/photo checks and identity/licence/availability gates. A missing outgoing declaration is Not requested — notification only, not a missing-confirmation exception. Preserve v1 two-driver/explicit-attestation rules only for v1 requests; do not silently convert them.

The approved new request form contains outgoing driver (read-only), incoming driver and reason. Remove planned location, typed coordinates, planned instructions, expected exchange time and planned/unplanned checkbox. The user explicitly accepted this immediate-only change on 20 October; do not ask for it again. Future scheduling is deferred.

Alternatives considered:

| Approach | Trade-off | Recommendation |
|---|---|---|
| Immediate authorised transfer with B acceptance and A notification | Approved simpler workflow; requires versioned completion policy and compatible database/hash changes | Selected |
| Keep future scheduling, remove only planned location | Retains expected-time and future reservation semantics | Rejected for new submission-scope requests; preserve legacy scheduled requests |
| Defer new transfers for submission | Protects the rest of the MVP; must preserve history and existing custody behaviour | Fallback if acceptance fails |

Do not replace this with a dispatcher-only name swap: that would leave the custody/access/evidence problem unsolved.

### Verification of the proposed direction

**Verdict:** the direction is justified, with a bounded implementation. Fewer manually entered fields remove a source of misleading evidence and reduce dispatcher work. Reuse the incoming phone capture, custody derivation and server completion; explicitly version the changed required-confirmation policy. The header move improves discovery; it does not itself change correctness. Reliability gains depend on R1–R12 and on executable acceptance, not on the simpler form alone.

**Trade-off:** product complexity decreases, but the upgrade needs a compatible request/schema/commitment change. That is real work before 23 October. Keep legacy planned records and receipts read-only/verifiable; do not undertake a general data-model cleanup or event-framework rewrite. If the approved new flow cannot be finished safely by freeze, defer new arrangements rather than silently shipping a different scheduling/confirmation policy.

**Operational cost of immediate requests:** an incoming driver is reserved from request time until completion/cancellation/terminal-trip resolution. Do not use Request transfer as a casual future booking. Show pending state and provide the existing explicit cancel/replace actions; abandoning a dialog must not leave an unnoticed reservation. Do not introduce a new automatic-expiry policy at this deadline.

**Safeguards:** dispatcher authorisation, B's authenticated acceptance, identity/licence/availability checks, actor/custody attribution, immutable history and server-effective access change remain required. The user deliberately removed A's required declaration for v2. Commit that policy explicitly; never label dispatch authorisation as A's consent. A new v2 transfer cannot be completed without B's saved acceptance. Dispatcher recheck/admin identity attestation may complete already-saved B acceptance after a blocker is resolved; the legacy missing-confirmation bypass remains v1 only.

### Location and time truth

- B's takeover acceptance attempts a fresh foreground phone location, with coordinate accuracy and the observation time. Legacy v1 still records each confirming driver independently. Reuse the existing geolocation service, but extend its data path: useSubstitutionCapture currently stamps declaration time before awaiting GPS, LocationContext drops the location timestamp, and useLocation stamps callback time rather than retaining the device position timestamp. These are not already four-clock observations. Preserve declaration time, device location-observation time, server receipt time and server-effective custody time independently through local persistence, HTTP, storage, commitment, dispatcher detail and audit. Historical observation times remain unknown, never copied from declaration time.
- New v2 stores B's own observation only; A has no requested handover observation. Historical A/B observations remain separate where they exist. Never copy B's fix to A, use notification read time as consent, label a tracker reading as A's phone fix, or infer a proven shared exchange point. Opening A's notice must not trigger new location tracking.
- Keep device declaration/observation time, server receipt time and server-effective custody time separate. Offline capture never backdates permissions. The outgoing driver remains current until the server commits completion.
- Proposed failure policy: retain valid captures if GPS is unavailable, show the missing-location status and reason where available, and never present that result as location-verified. Preserve the existing fail-open location policy; do not invent a GPS-based custody authorisation gate. This recommendation needs explicit agreement if the team wants GPS absence to block completion instead.
- Use the existing per-capture phone/tracker assessment as corroboration; missing/stale tracker data is not proof of collocation or misconduct. Do not add a new phone-distance rejection threshold within the submission scope.
- The v2 demonstration uses two physical phones/accounts to prove that B accepts and A is notified/loses access, including while A is offline. Only B must obtain a real phone observation for the ordinary GPS-success case. Legacy two-capture tests still cover v1 independently. Development fallback coordinates/browser overrides are labelled simulations, not acceptance evidence.
- GPS/photos/identities stay in existing approved storage; only commitments reach Hedera.

The current SubstitutionConfirmationDetail does not expose coordinates, accuracy or assessment, and audit HandoverDeclarationRecord exposes only location_recorded. Extending those projections is necessary, not just displaying existing fields. Capture a structured unavailable reason when supplied by the device; do not invent one for legacy null GPS. Test delayed location callbacks, device position timestamps, unavailable GPS, offline restart and old confirmation bodies with no new fields. Each recorded phone observation retains its actual actor; new v2 does not collect an A declaration. A successful B capture is not proof of collocation or cryptographic integrity.

### Immediate-request consequences

For the approved immediate scope, use server request time for initial licence checks and begin the incoming driver's reservation immediately. Recheck eligibility at server completion as today. Preserve reservation release on cancellation, replacement and terminal trip. There must still be only one pending request per trip, and a busy incoming driver must be refused.

The existing request model, contract and commitment require exchange and expected-time fields; the completed row and audit schema also require an exchange label. Removing form controls alone is insufficient. Do not fill required fields with zero coordinates, the dispatcher location, the truck location, an invented label or a fake expected time. New requests must explicitly represent that no plan was supplied. A coordinated additive migration is required for the recommended no-plan design. Keep old planning metadata available as legacy context without modifying it. Version the new custody payload and retain the exact v1 canonical bytes/hash interpretation, while strengthening unsafe verification checks (R5/R6). Preserving the buggy verifier is not a compatibility requirement. Do not change old hashes to fit the new shape.

Existing pending requests retain v1 request/commitment semantics, including their planned reservation window and both required confirmation roles, through confirmation, cancellation and replay. To use the new B-only policy, explicitly cancel/replace through the authorised workflow with a fresh v2 request; inherit no old confirmations. A pre-upgrade confirmation or offline capture must not be recast as a v2 immediate declaration. The migration must preserve all existing planning/confirmation values. Test an in-flight v1 request with one saved confirmation and an offline second capture through upgrade and completion, plus cancellation/replay. This is separate from testing already-completed old receipts.

Stage 0 must freeze three distinct concepts: request format, the existing optimistic request version, and anchored payload version. Version dispatch must be explicit in completion, pre-anchor rebuilding, recovery and receipt verification; changing one global payload constant breaks v1 recovery. Preserve old operation body digests and stored result_json: adding parsed defaults to a v1 request must not change its retry digest. Agree how old installed clients are handled, including an already-accepted arrange/replace replay and an unaccepted old-format new arrangement. Add upgrade fixtures for those operations, v1-to-v2 replacement with no inherited captures, a mixed-version custody chain and an owed v1 anchor recovered after upgrade. Old issued audit manifests/PDFs remain byte-for-byte stored evidence.

### Header behaviour

The live trip page renders components/trips/TripSummary.tsx; do not implement against the older app/.../TripHeaderSummary.tsx merely because its filename sounds relevant.

- Place a compact Transfer driver button in the existing Driver cell's label/action line. Preserve the driver name and phone link. No new header row, padding block or column.
- With a pending request, use View transfer in that same slot; never start a duplicate request. The dialog shows state and existing cancel/replace/attested-completion controls as permitted.
- Mount one dialog/controller at trip-page level so it survives opening/closing the sidebar. No nested buttons and no modal nested inside the detail-panel dialog.
- Keep detailed history and late-evidence review in the information panel; remove the duplicated initiation button there. Moving the entry point is not a reason to hide history.
- In compact header mode, where the driver facts row is intentionally hidden, place an equivalent compact action in the existing title-row action cluster without adding a row. At narrow widths, use a labelled accessible icon action if needed; verify that neither the action nor long names push the header taller.
- Closed/cancelled trips and disabled new-arrangement state must not offer a new transfer. Existing pending resolution/history remain accessible when new arrangements are disabled.

### Trip timeline — completed custody events

**Current implementation checked on 20 October:** TripTimeline renders the sorted phase plan plus phase/trip exception records. It does not consume trip.driver_substitutions. DriverSubstitutionPanel displays those requests/history in the information sidebar. A successful ordinary transfer therefore does not currently produce its own visible timeline event. The existing per-capture/seal services can independently create genuine findings, which remain exceptions.

**Recommendation:** make a completed substitution a distinct, unnumbered **Driver transferred — A → B** custody event. It is not a new phase, a phase completion, an exception, or a new stop. It must not affect phase status, sequence, progress, hold state, exception counts or review workload merely because the transfer occurred.

Presentation and source of truth:

- Use the existing completed DriverSubstitution/request/confirmation records as the source; add a read projection and renderer rather than writing a duplicate timeline table or a TripException. One completed_substitution_id yields one canonical visible event.
- Enumerate completed DriverSubstitution rows, including request_id=NULL legacy rows. The current trip.driver_substitutions field is a request list and cannot supply those rows. Add a separate completed-record projection with substitution ID/sequence and optional request detail; keep the existing request list for pending/cancelled history. Extending only GET /{request_id} is insufficient. Legacy declaration, completion mode, commitment and phase context remain explicitly unknown/unrecorded where absent.
- Insert each event as its own sibling row between the existing phase cards, using server-effective custody time. Loading completed at 10:00, transfer at 10:05 and Departure completed at 10:10 must render Loading → Driver transferred → Departure. The existing phase list keeps its original order and original stable keys.
- Derive placement from valid recorded phase completion boundaries, not the current phase cache, a device capture time or planned future dates. A transfer during an unfinished phase follows the last completed milestone and precedes that phase's eventual completion card, labelled During loading/in transit/etc. only when the ledger proves that context. This is chronological milestone placement; existing dated events inside a phase card keep their internal layout.
- Make the small change in TripTimeline's parent composition: interleave read-only transfer rows around unchanged TimelinePhase cards. Do not alter phase numbering/progress, phase-act models, exception placement, expansion state or jump-to-current anchors. No generic event framework or duplicate nested rail.
- If a legacy event's placement cannot be established, show it once in a labelled Unplaced historical driver transfers section with its known effective time and Phase context not recorded. That exception is for genuinely ambiguous history, not a shortcut that moves all new transfers out of chronological order. A missing implementation of known placement is an unmet acceptance requirement.
- For transfers sharing the same effective timestamp, custody sequence determines their order; use stable IDs for rendering. Device capture time is an observation, not an alternative permission-change clock. An offline confirmation received later must not make the timeline imply that B had system access earlier.
- The collapsed row shows A → B, effective time, completion mode and anchoring state. Expanded detail shows the reason, dispatch authorisation, B's actual acceptance/location/accuracy/capture/receipt times, vehicle/seal checks/photos, notification facts, arranging/completing actors, identity attestation and appended clarifications. Show A: Not requested — notification only for v2. Show both independent declarations on v1 only when actually recorded; missing required declarations and unavailable GPS remain explicit. Location corroboration and cryptographic integrity are different states: no single generic verified badge may imply both.
- Scope the initial work to dispatcher trip timeline. Preserve former-driver read restrictions; do not expose subsequent live trip data by reusing a dispatcher detail view inside the driver app.
- The existing dispatcher GET request and trip list carry ConfirmationSummary rather than full SubstitutionConfirmationDetail; use the existing dispatcher router for a same-organisation completed-substitution detail read, keyed by substitution ID, with an optional request ID. Include independent location fields, declarations, scoped artifacts, clarifications and receipt/integrity state. Reuse the existing read/building helpers where appropriate. Do not send drivers to the dispatcher endpoint or use their account-scoped context endpoint to power the dispatcher.
- A request that is pending or cancelled is not a completed transfer. For submission, show these states in the header/View transfer dialog and request history, not as completed-custody rows. Request/confirmation/cancellation facts can be shown inside the transfer detail; avoid three noisy main rows for one transfer. A clarification appends an attributed entry to the event detail and audit without moving/replacing the completed event.
- A genuine finding remains a separate linked exception with normal severity/review treatment. New v2 must still report B's damaged/missing seals, but cannot claim an A-versus-B seal mismatch because A makes no declaration. Preserve pairwise comparison on legacy v1; do not fabricate an A reading or build a new cross-phase comparison engine in this change. A historical baseline is only evidence when explicitly recorded and attributed. Never duplicate exception counts.

**Timeline acceptance:** ordinary transfer creates exactly one custody event and zero new exceptions; B's genuinely damaged/missing seal (or a genuine legacy v1 pairwise mismatch) creates its separately linked finding; current phase/progress remains unchanged; cancellation creates no completed transfer; two transfers during one transit phase remain distinct; equal timestamps follow custody sequence; refresh/replay produce no duplicates; offline observation/receipt/effective clocks stay distinct; minimised/expanded views and keyboard detail access remain usable; old records with unknown phase context are still visible without invented context.

**Bounded placement is now selected:** chronological sibling rows around the unchanged phase cards, not a top-of-timeline transfer list. Tests must cover after Loading, during transit, equal timestamps, late offline acceptance, refresh/expansion preservation and genuinely unplaceable legacy history. This requires a small parent-renderer change; it is not zero timeline code change and does not promise a global merge of every nested phase event.

## Responsibility proposal

The existing plan assigns Ciaran the contract and shared types and Tim the driver app and remaining backend stages. Preserve that ownership until the humans agree otherwise. Suggested split: Ciaran coordinates the contract, dispatcher header/review/audit work and final acceptance; Tim fixes driver capture/offline behaviour and backend custody/evidence paths. Coordinate shared model/schema/migration changes explicitly. This is a proposal, not reassignment of a teammate's branch.

## Stages, observable outcomes and checks

### Stage 0 — scope/contract checkpoint, 20 October

**Goal:** both developers can state exactly what a new transfer request means and what stays historical.

**Where:** this plan; docs/contracts/driver-substitution-v1.md (preserve as the historical contract); a versioned amendment/new contract; frontend/shared/lib/types/driver-substitution.ts and mocks; backend schemas/models/canonical payload design.

**Actions:** carry forward the approved immediate-only/B-accepts/A-notified policy and existing GPS fail-open rule; agree compatibility discriminator and new payload version; confirm the freeze clock time, owners and two test phones. Identify real eligible test drivers, licence expiry records, and an admin account for the approved PENDING-identity attestation path. Do not set a production driver VERIFIED merely for the demo: no new genuine verification writer was established by the earlier review.

Record actual owner names, owner estimates, dependency order, a two-phone smoke cutoff before the final freeze, and the clock time of the freeze in the implementation plan's gate record. Preserve existing GPS fail-open behaviour unless the user deliberately changes it. Immediate-only, A notification without confirmation and chronological event placement are now approved user decisions. Do not reopen them as unanswered scope questions. Technical compatibility and team scheduling still need coordination. Safety repairs may proceed when subsequently authorised.

**Verify:** schema/fixture examples cover a new no-plan request, a legacy planned request, B-only v2 acceptance with A notified/offline, legacy two-capture observations, unavailable GPS, an old v1 receipt and an admin-attested transfer. Both owners check the exact field names/nullability and agree the examples. These are a contract gate, not proof of real operation.

**Fence:** no new identity vendor, scheduling engine, push delivery or route planning. Do not enable new real transfers.

### Stage 1 — a simplified complete online transfer, 20–21 October

**Goal:** from the header, request a transfer with driver/reason only; B accepts without any response from A; the server completes and B continues the same trip while A is notified.

**Where:** dispatcher components/trips/TripSummary.tsx, DriverSubstitutionDialog.tsx, DriverSubstitutionPanel.tsx, app/(app)/trips/[id]/page.tsx; shared types/mocks; backend schemas/driver_substitutions.py, db/models/driver_substitutions.py, db/models/trips.py, orchestration/substitutions/{service,eligibility,availability,request_read,reads,canonical,anchors}.py and orchestration/verification/{substitution_payloads,service}.py; driver card/flow/capture hook/location adapter; one coordinated hand-written Alembic migration for the agreed no-plan and observation fields.

**Actions:** implement the agreed contract and legacy compatibility; approved immediate reservation and incoming-only acceptance semantics; move the dispatcher entry point; remove planning inputs/copy from both apps. Fix R1 (card crash), R2 (QR wire mismatch) and R8 (stale completion) from the list below. Preserve phone observations through actual upload/confirmation/read/audit paths. Surface recorded/unavailable state and use server-effective custody time.

**Verify:** targeted dispatcher header/dialog tests and real driver-card render; actual HTTP contract test for QR custody; backend licence/availability/version/idempotency tests; old-v1/new-payload verification; new-form API tests with no exchange fields. Then click the full real-backend online flow with two distinct accounts, A online and A offline/unread, and verify B's acceptance, A's durable notices, B's next phase plus receiver QR. Run both confirmation orders separately for legacy v1 only. Compare header height before/after at the supported desktop/narrow layouts and test compact mode, long names and keyboard access.

Use independent database sessions to race two different trips requesting the same incoming driver: overlapping reservations must yield one success and one availability refusal. Also test an immediate request against an overlapping legacy scheduled reservation, and an adjacent non-overlapping window. A per-trip pending unique constraint alone does not prove driver exclusivity.

An unresolved immediate reservation is open-ended until resolution; do not expect adjacency with a future booking to pass. Adjacent-window success applies to bounded legacy windows or a completed takeover with a known future planned end. State the tested window type in each fixture. Pending discovery with B's unrelated assignment is a legacy/snapshot or refusal test; an overlapping busy B cannot successfully complete the new immediate online scenario.

**Fence:** no rewrite of original trip parameters or completed phases, no fake coordinates, no independent duplicate transfer controller. Existing evidence stays intact on migration. A developer applies merged migrations through the team's process; the agent must not run them on shared Supabase.

### Stage 2 — custody and evidence correctness, by end of 21 October

**Goal:** stale/offline work remains attributed and reviewable, and integrity/audit results tell the truth.

**Where:** driver lib/hooks/useOfflineQueue.ts, lib/hooks/useSubstitutionCapture.ts and lib/offline/*; backend substitutions/{late_evidence,artifacts,anchors}.py, verification/substitution_payloads.py, audit_packs/custody.py, schemas/audit_pack.py and audit PDF template; dispatcher LateDriverEvidencePanel.tsx and realtime wiring.

**Actions:** fix R3–R7 and R9–R12 below, with permanent regression tests for each. Complete the owed capture/offline tests; do not merely rewrite failing assertions to match unsafe behaviour. Preserve old receipt formats and existing read restrictions.

**Verify:** run permanent reproductions for A→B→A, account switch between each network step, ordinary photo uploaded just before transfer, changed local hash versus existing receipt, completed metadata tampering, saved clarification export, completing-account export, late payload/photo display and live arrival. A late receipt must leave current phase, current holder and chain length unchanged. Confirm no evidence is cleared before a safe receipt/exact replay acknowledgement.

**Fence:** do not add new action kinds or relax actor/custody checks for convenience. No silent evidence deletion, inherited fake verification status or relabelled captures.

### Stage 2B — visible transfer record on the existing timeline, 21 October

**Goal:** a completed handover appears as its own chronologically placed custody event, with B's acceptance and A's notification-only status (or actual legacy declarations) inspectable without becoming a phase or exception.

**Where:** dispatcher components/trips/TripTimeline.tsx, TimelinePhase.tsx, existing phase/event projection helpers and their tests; a small DriverTransferTimelineEvent component if warranted; shared driver-substitution/trip types; backend orchestration/substitutions/reads.py, schemas/{driver_substitutions,trips}.py and the authorised completed-substitution detail endpoint. The projection starts from completed rows, including request-less legacy history. Inspect the actually used phase renderer before choosing an insertion point; InTransitTimeline.tsx's filename alone does not establish it is the active rail.

**Verify:** execute the timeline acceptance cases above and HTTP authorisation tests for the richer dispatcher detail. Confirm normal transfer does not increment exception counts or create PhaseEvent/TripException rows, and the event opens correct declaration/artifact/correction details. Include unknown historical phase, equal timestamps, two transfers in one phase, reduced/minimised view and delayed offline confirmation fixtures.

**Fence:** read projection over existing custody facts; no generic event bus, duplicate event store, new phase, forced timestamp reordering or access-policy relaxation. If bounded placement cannot be integrated by the cutoff, record the timeline requirement as unmet in the keep/disable decision rather than claiming the existing sidebar already satisfies it.

### Stage 3 — release verification and demonstration, 22 October

**Goal:** a frozen candidate completes the real journey and passes the failure-path tests below with saved evidence.

**Where:** existing backend/frontend test suites and CI, disposable PostgreSQL matching the supported CI major (17), the actual hosted API/worker, browser dispatcher and the production driver build on two phones. Update frontend/driver-pwa/docs/fp-83-driver-validation.md and record commit/build IDs, test results and limitations.

**Verify commands:** from backend run pytest, ruff check ., mypy ., python scripts/check_structure.py and lint-imports in the configured environment; run alembic heads and the full migration chain on a disposable supported PostgreSQL database with the repository's CI Supabase stub. In frontend/dispatcher and frontend/driver-pwa run npm test, npm run type-check, npm run lint and npm run build with documented non-secret configuration. Run the existing native sync workflow and test the installed Android build. These checks must be executed and their results recorded; the plan does not claim they currently pass.

**20 October test-runner diagnosis:** the stop hook reported 313 errors because the shared test_engine fixture could not open its configured database connection in the restricted environment (PermissionError before test bodies). Despite its directory name, tests/unit includes database-dependent cases. Running the unchanged current source snapshot against an explicitly configured disposable local PostgreSQL database produced **1,897 passed, four skipped, nine warnings**. No backend fix was needed for that hook error. The hook also runs on an unrelated untracked backend/node_modules directory. Do not weaken assertions or silently skip database cases to resolve this environment problem; provision a safe test database and the required runner access. This unit result does not replace the full integration, migration, driver or physical-device release gates.

**Trigger correction later on 20 October:** `.codex/hooks/test-summary.sh` now excludes dependency-only node_modules dirtiness. Six focused checks covered dependency/clean skips, failing tracked source and untracked tests, passing source tests, and recursion protection; the installed hook also exits successfully on this documentation-only working tree. Backend changes still run the unit suite and failures still block. The database-access requirement above is unchanged.

**Fence:** no unrelated refactors or new features on the frozen candidate. A substantive fix requires rerunning affected regressions and the real acceptance flow. Do not change lint thresholds or skip failed safety tests to manufacture a green result.

### Stage 4 — keep or disable, 22 October before submission preparation

**Keep:** all required acceptance cases pass, including the chronologically placed custody event and evidence detail; B's real phone capture plus A's notices/offline non-blocking behaviour are demonstrated; CI/check failures are resolved or clearly separated as documented pre-existing non-feature debt without waiving any safety/operation failure; supported migrations, real API/storage/worker/anchor recovery and audit verification are demonstrated. Both owners record acceptance against one exact commit/build.

**Minimum safety gate applies even when arrangements are disabled:** account isolation throughout ordinary and substitution upload pipelines; evidence retention/exact replay; existing custody/access; pending cancellation/resolution; old/new receipt verification and issued audit preservation must pass on the release candidate. The flag does not remove those paths. In particular R3/R7 affect ordinary evidence handling too. If this floor fails, do not call the release safe or completed: stop candidate release, preserve data, report the failing regression and require a human-led repair/recovery decision. Do not suggest a blind code/database rollback after v2 data exists.

**Disable new arrangements:** if the minimum safety gate passes but the new-flow/timeline/physical-device acceptance fails at the agreed cutoff, use DRIVER_SUBSTITUTIONS_ENABLED=false and remove/disable initiation affordances truthfully. Preserve derived current ownership, pending resolution, former-driver history, recorded transfers, late evidence and verifiers. Do not reset Trip.driver_id or undo completed custody rows. Confirm the ordinary trip still completes and document the feature as deferred rather than demonstrated complete. Resolve/cancel pending requests only through the authorised workflow and only when that path is proven safe. Disabling arrangements is scope deferral, not a fix for unsafe surviving paths.

No last-minute dispatcher-only swap or weakened evidence rules. Preserve 23 October for final submission, not first integration.

## Review repairs to track

| ID | Defect from the earlier merged-dev review | Done means |
|---|---|---|
| R1 | Pending driver card throws through Button asChild/Slot | Real pending-card render works in Home and Trips; regression passes |
| R2 | QR custody JSON/query mismatch | Actual HTTP request supplies the correct sequence after transfer; B issues receiver QR |
| R3 | Unknown-sequence draft loads after A→B→A | Old/unknown-period evidence is retained; never stamped as new current work |
| R4 | Late evidence rejects already-uploaded ordinary photos | Upload-before-transfer/report-after-transfer produces one valid late receipt with correct actor/period |
| R5 | Chain verifies rewritten local commitment despite old receipt | Chain and receipt checks both fail altered evidence; receipt subject/kind/trip/hash checked; corrections covered |
| R6 | Completed depot/planned metadata ignored by verifier | All exported authoritative metadata is committed or validated against committed fields; legacy receipts still verify |
| R7 | Account switch mid-pipeline permits wrong-account sends | Each network step stops on account generation change; no later request uses the new account |
| R8 | Stored pending response overrides fresh completion | V2 B acceptance and both legacy v1 confirmation orders, refresh and restart show authoritative completed/cancelled state |
| R9 | Late evidence acknowledged without visible contents | Dispatcher can inspect typed payload and authorised photos before recording review |
| R10 | Newly arriving late evidence absent from open panel | Committed event plus refocus/reconnect refresh reveals it; other dispatcher acknowledgement refreshes |
| R11 | Saved clarifications missing from new audit packs | Note/reason/author/time/hash/receipt appear in subsequent manifest/PDF; original stays unchanged |
| R12 | Completing actor lost from audit export | Distinct arranger and completing driver/dispatcher accounts are attributed explicitly |

The earlier wrong-account reproduction established wrong-token attempts, not successful backend acceptance as another driver. Keep that distinction in tests and reporting.

## Real acceptance session

**Setup:** one dispatcher laptop, two physical phones signed into distinct same-organisation drivers A and B, and access to C/another organisation for negative tests. Use isolated test trips and fictional cargo in the real application environment; the API/database/storage/worker must be connected. Use genuine verified records if available, otherwise demonstrate and label the approved admin attestation for PENDING identity. A mock driver VERIFIED fixture proves the automatic path only in automated tests. Install a production build or use the deployed secure web app; do not use the development GPS fallback as acceptance evidence.

| Case | Required observation |
|---|---|
| Ordinary no-transfer trip | Existing activation→delivery→receiver confirmation and audit still work |
| New v2 A→B with A online/offline/unread | Dispatch authorises, B alone accepts using existing checks; A receives durable notices but never needs to respond; eligible completion happens once; A remains current before completion and loses live-write access afterward |
| Legacy v1 A first and B first | Old pending requests keep both-role requirements and exact replay; explicit v2 replacement starts fresh and never inherits confirmations |
| Existing receiver link/consent races transfer | Link remains on its original phase/expiry; accepted receiver evidence is not retargeted/relabelled; consent and transfer complete without duplicate confirmation or deadlock; A cannot mint a new link after transfer |
| Transfer while EXCEPTION_HOLD | Custody changes once; hold/review state and phase progress remain unchanged; B still cannot advance through the existing hold |
| Location evidence | B's actual fix/accuracy and distinct acceptance/location-observation/receipt/effective clocks survive HTTP, restart, detail and audit; no invented A confirmation/GPS; legacy actual declarations preserved; unavailable GPS/tracker explicitly unverified |
| Identity/licence | PENDING only completes through recorded admin exception; ordinary dispatcher cannot bypass it; FAILED/inactive/expired/missing licence refused; valid-through-today uses SAST |
| Required acceptance | V2 cannot complete without B's saved acceptance; A absence is expected and needs no missing-confirmation reason. Legacy v1 explicit dispatcher overrides retain their author/reason and never invent captures |
| Offline/restart | Capture offline, close/reopen app, reconnect; bytes/actor/times retained; same key creates no duplicates; B's live writes only start after server completion |
| Partial upload at transfer | A photo lands before handover, report after; accepted as late evidence; phase/custody do not advance |
| A→B→A and account switch | Old A-period work rejected from current path and retained; switching account mid-upload stops further sends; history scoped |
| Cancel/replace/terminal trip | No transfer from stale request; captures retained; reservation released when appropriate; no duplicate pending request |
| Upgrade with an in-flight v1 request | Planning metadata/first confirmation unchanged; offline second confirmation, completion, cancellation and replay still obey v1 semantics |
| Old-client operations and mixed versions | Pre-upgrade accepted arrange/replace/confirm operations replay with unchanged digests; old unaccepted creates follow the agreed policy; v1→v2 replacement inherits no captures; mixed chain and owed-v1-anchor recovery verify |
| Request-less legacy timeline | Completed row remains visible exactly once; no invented request, declaration, observation time, completion actor or cryptographic verification |
| Two-trip incoming-driver race | Independent concurrent sessions cannot reserve the same driver for overlapping periods, including legacy scheduled versus new immediate requests |
| Race/lost response | Two final confirmations, double taps and response loss yield one transfer/receipt; accepted replay distinguished from generic conflict |
| Audit/integrity | Actual arranger/completer, required B acceptance and A notification-only policy (both actual declarations for v1), late evidence and clarification exported; metadata/photo/local-hash tampering fails appropriate verification; old receipt still verifies |
| External failure | Anchor outage displays pending truthfully; recovery anchors without second transfer; storage/network failures preserve captures |
| Discovery/permissions | B with no active trip still discovers transfer; former/unrelated/cross-tenant accounts receive restricted responses; pending remains distinct from live assignment |
| Header/layout | One compact entry next to driver, pending becomes View transfer; no increased normal header height; sidebar closed and compact/narrow/keyboard paths work |
| Custody timeline | One chronologically placed normal transfer event, zero new exceptions, unchanged phase progress; recorded declarations and completing actor accessible; repeated/same-time transfers ordered and deduplicated; actual findings linked separately |
| Flag-off minimum safety and fallback | New arrange/replace are refused; exact accepted replays remain valid; existing pending confirm/complete/cancel, current holder, history, late evidence and normal trip completion still work; account-switch/retention/integrity regressions also pass with flag off |

For each run, save the trip/request IDs, exact application commit/build, confirmation order, device observations, effective server time, next phase actor/sequence, anchor/verification result and audit output. A video alone is not proof of stored attribution; inspect authorised API/database readbacks in the test environment too.

## Risks and tripwires

1. **Contract/hash change expands unexpectedly.** If removing planning requires changing old payload interpretation or editing historical rows, stop that approach in Stage 0. Preserve versioned legacy verification; if the compatible change cannot be finished by freeze, defer new transfers rather than inventing planned data.
2. **Real-client operation differs from fixture success.** If the two-phone Stage 1 path cannot produce an honest B observation and prove completion without A confirmation or the required admin is unavailable, resolve that before more cosmetic work. Label simulations and defer enabling if no real demonstration is possible.
3. **Scope consumes final submission time.** At the earlier agreed smoke cutoff, a missing real two-phone flow or an unbounded compatibility task triggers immediate scope review; do not first discover it at final freeze. At the agreed 22 October cutoff, a passing minimum safety floor plus unmet feature acceptance triggers disablement and ordinary-journey regression; a failing safety floor blocks candidate release. No feature is kept merely because most code is written or the screens look complete.

## Outstanding confirmations

- Confirmed by user: immediate-only requests, dispatcher authorisation plus B acceptance, A notified without confirmation, and chronological sibling event placement. These are settled product decisions, not outstanding questions.
- GPS-unavailable remains fail-open under the existing FP-83 contract unless the user explicitly chooses a stricter policy; stricter policy requires a revised contract and tests before dependent coding.
- Team confirms the earlier smoke cutoff, 22 October freeze clock time, named stage owners/estimates, phone availability and admin identity-attestation availability.

These affect implementation/release, not the validity of the review findings. No calendar date other than the 23 October submission deadline is presented as an agreed commitment.
