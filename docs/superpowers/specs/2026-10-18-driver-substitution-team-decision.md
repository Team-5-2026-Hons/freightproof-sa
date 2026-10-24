# FreightProof SA Driver Substitution Specification

**FP-83 | Proposed final feature for submission | 18 October 2026 | Version 0.1**

**Status:** Proposed for team confirmation. The workflow, scope and estimates below are recommendations; they do not record team approval or authorise implementation.

## 1 Decision requested

We need to decide whether to build a complete driver substitution flow as our last feature before submission, or defer it and protect the remaining time for testing, documentation and demonstration preparation.

The proposal is to let a dispatcher arrange a substitution from the trip detail page, give the replacement driver clear collection information, record the handover through both drivers, and preserve each driver's period of custody and evidence. The original driver remains part of the trip record after the replacement takes over.

**Assessment:** This is a large feature with a high backend blast radius. The provisional estimate is 10–15 focused developer-days for one developer, or approximately 3–4 calendar weeks allowing for integration, review and coordination. This is an initial scope estimate, not a delivery commitment. The submission deadline, available team capacity and protected hardening period still need to be confirmed.

### Why the feature matters

A driver name changing on screen does not establish that the replacement reached the truck or accepted custody. A complete record must distinguish the dispatcher arranging the exchange from the drivers completing it. It must also let the replacement continue the same physical journey without erasing the outgoing driver's actions.

The proposed feature has a clear demonstration outcome: Driver A hands over to Driver B; B can continue the trip; A cannot advance it; both retain their evidence; availability changes correctly; and the complete journey still verifies.

### Recommendation for the submission decision

Treat FP-83 as an epic with linked implementation tasks and one complete acceptance boundary. Proceed only if the team can allocate an accountable owner, coordinate the affected modules, and retain time for regression testing and submission preparation after the integration work.

If that capacity is unavailable, defer the feature and document the current limitation. A dispatcher-only name swap would leave the custody, access and evidence problems unresolved.

### What is already present

The reviewed code contains the `DriverSubstitution` model and migration, a substitution receipt type, and audit-pack readers for substitutions. The dispatcher driver modal remains read-only, and the existing driver access and availability code still uses the original `Trip.driver_id` in important paths. These are useful foundations, but they do not implement the proposed workflow.

The September design already proposes an anchored custody amendment with separate driver seal checks and incoming-driver identity verification. This specification expands that direction into a team decision scope. Existing source code remains authoritative; Jira status and deployment readiness were not revalidated for this document.

<!-- pagebreak -->

## 2 Handover lifecycle and responsibility

### Proposed normal flow

1. **Arrange.** The dispatcher chooses an eligible replacement, records the exchange point, expected time and instructions, and authorises the proposed substitution.
2. **Notify.** Both drivers receive a persistent notice. The incoming driver can view the pending collection assignment before receiving permission to advance the trip.
3. **Hand over.** The outgoing driver records the vehicle and trailers, seal details, relevant discrepancies, location and capture time on their own device.
4. **Take over.** The incoming driver records their identity-check outcome, independently checks the vehicle and seals, and submits their own evidence using their own account.
5. **Complete.** The server validates the required records and atomically completes the transfer. The incoming driver becomes the current driver for subsequent trip actions.
6. **Confirm.** Both drivers and the dispatcher see the completed transfer and its effective time. The trip continues from its existing progress.

### State and timing rules

The proposed lifecycle has pending, completed and cancelled states. Pending records expose which confirmations are outstanding. Only one pending substitution is allowed per trip. Confirmations are tied to a specific version of the arrangement; a material change to the driver, place or time requires renewed confirmation and notification.

The outgoing driver remains the system's current driver until completion. A handover declaration alone does not silently release them. This rule describes the application record; FreightProof does not control whether a truck physically moves.

Expected exchange time, each driver's capture time, server receipt time and effective transfer time are separate facts. For the normal online flow, effective transfer occurs at server completion. A retrospective declaration must retain its claimed occurrence time separately and must not silently rewrite past permissions or trip progress.

A pending arrangement can be cancelled or superseded with history retained. A completed transfer is permanent evidence. Corrections require an additional attributed record; they must not overwrite the original handover.

### Each driver's responsibility remains visible

| Participant | Recorded custody period | Evidence retained |
|---|---|---|
| Original driver | Activation until completed transfer | Their trip actions, captures and handover declaration |
| Replacement driver | Completed takeover until the next transfer or trip end | Their takeover declaration and subsequent actions |
| Later replacement | Their completed takeover until their release or trip end | Their own actions and evidence |

Each relevant action must retain the actual actor and, where needed, the associated custody period. The current driver's name must never be used to relabel historical actions.

A discrepancy reported at takeover retains both drivers' evidence for comparison. The system records the facts and review outcome; it does not automatically decide which driver caused the discrepancy or assign liability.

Former drivers retain an appropriate historical view of their participation. Their access to subsequent live locations, unrelated evidence and other personal data is restricted by the agreed read policy.

<!-- pagebreak -->

## 3 Dispatcher and driver experiences

### Dispatcher trip detail

The trip detail page is the primary control point. Add a visible Driver and handover section, with a secondary entry from the existing driver modal. Show the current driver, pending substitution, outstanding confirmations, completed handovers and anchor status. The timeline distinguishes arrangement, cancellation and completed custody transfer.

| Form field | Required behaviour |
|---|---|
| Outgoing driver | Filled from the current driver and read-only |
| Incoming driver | Eligible driver with availability information |
| Exchange point | Named place with usable coordinates or an existing exchange-point reference |
| Expected time | Future arrangements permitted; displayed in SAST |
| Instructions | Entrance, meeting point and other relevant collection details |
| Reason and planned flag | Context retained with the arrangement |
| Approving dispatcher | Taken from the authenticated account |

An exchange label such as Harrismith is insufficient on its own. The replacement needs a usable meeting point. Display any latest vehicle position separately, with its observation time, so it cannot be mistaken for the agreed location.

The dispatcher can change or cancel a pending arrangement, see missing acknowledgements and record an authorised alternative when a driver's confirmation is unavailable. The interface must distinguish normal completion from completion with missing confirmation.

### Outgoing driver

Show a persistent notice identifying the replacement and planned exchange. Explain that the driver remains current until completion. Provide a focused Hand over trip flow for vehicle and trailer confirmation, seal number and condition, supporting photos where applicable, and discrepancies.

After completion, show when and to whom the trip was handed over. Remove ordinary trip actions and move the trip into that driver's participation history even if the journey remains active. Do not mark the whole trip closed.

### Incoming driver

Show a pending handover assignment before takeover, including trip reference, exchange point, expected time, instructions, relevant contact details, vehicle and trailer registrations, remaining stops, current progress and relevant unresolved issues. Preserve existing restrictions on parcel-level information.

Provide a Take over trip flow on the driver's own account and device. Record an independent seal check and the incoming driver's identity-check outcome. Store this against their participation; the original driver's identity result cannot stand in for it.

After completion, continue the existing trip plan. Do not repeat completed activation, loading or departure phases. Pending assignments must remain separate from the driver's current working trip so they cannot displace an assignment already underway.

### Notices and refresh

Persist notices for arrangement, material changes, cancellation and completion. Support in-app notices, push where available, and links to the correct trip or handover. Refresh on reopening and reconnecting, and provide suitable updates while the app remains open, including when the incoming driver has no current trip.

Delivery, viewing and explicit confirmation are separate states. A push message is not evidence that a driver read it. Keep notification payloads minimal and fetch details through authorised reads. An offline phone leaves acknowledgement outstanding; it cannot receive an immediate guaranteed update.

<!-- pagebreak -->

## 4 Backend rules and data changes

### Preserve the original trip

Keep `trips.driver_id` as the original driver because it is included in the journey lock. Derive the current driver from the original assignment plus the ordered chain of completed substitutions. Pending and cancelled arrangements do not change the current driver.

Use shared access rules for the current driver, the incoming driver awaiting takeover, and former participants. Apply them consistently across phase completion, evidence uploads, location recording, checkpoints, handover operations, route reads and driver trip queries.

| Role | Proposed access |
|---|---|
| Dispatcher in the owning organisation | Arrange and manage substitutions within the approved role policy |
| Current driver | Continue permitted trip actions and submit their handover evidence |
| Pending incoming driver | Read necessary collection context and submit takeover evidence only |
| Former participant | Read permitted participation history and use the defined late-evidence route |
| Unrelated driver or another organisation | No access to the substitution or trip |

Historical read access must not keep the outgoing driver's trip pinned as their working assignment. The driver app must use participation role as well as trip status. Dispatcher detail, lists, search and driver assignment selection must resolve the same current driver.

### Required stored facts

Extend the existing model or add supporting records for arrangement state and version, exchange coordinates and instructions, expected time, each driver's confirmation and evidence references, identity outcome, cancellation history, effective transfer time and any dispatcher alternative with its reason. Preserve actor IDs, server timestamps and immutable links from completed events to their custody period and evidence commitments.

The existing basic substitution row does not cover this workflow. Expect an Alembic migration. The precise table layout, indexes and module names belong in the implementation plan.

### Validation and atomic completion

Allow normal substitution on live trips, provisionally ACTIVE and EXCEPTION_HOLD. Reject closed or cancelled trips. The incoming driver must be active, belong to the correct organisation, have a valid licence under existing policy, differ from the outgoing driver, and satisfy availability rules.

Validate chain continuity so each outgoing driver matches the preceding current driver. Revalidate eligibility and availability at completion, not only when the form opens. Use consistent transaction locks for the trip and claimed drivers so concurrent substitutions, trip creation and phase writes cannot bypass the rules or deadlock. Use idempotent requests so retries do not duplicate confirmations or transfers.

### Availability and reporting

Make availability use the derived assignment and relevant time windows. Reserve the incoming driver for the pending exchange window according to the agreed reservation policy; release that claim on cancellation. On completion, occupy the incoming driver and release the outgoing driver's claim for the remaining journey, subject to their other assignments.

Update driver reports and audit exports to retain participation and event attribution. Do not attribute post-handover events to the original driver merely because the original driver ID remains on the trip. Any whole-trip metrics that cannot be fairly split must be labelled explicitly rather than presented as an individual driver's result.

<!-- pagebreak -->

## 5 Evidence integrity and failure handling

### Verification and anchoring

The original journey lock continues to verify against the original parameters. Independently anchor completed custody amendments and check their order, continuity and evidence hashes. The overall integrity view must account for the substitution chain, rather than reporting only that the original trip hash matches.

Persist a deterministic payload commitment for each completed amendment in the same transaction as the event. Submit its anchor after commit, expose pending, confirmed and failed states, and provide retry and recovery. Anchor failure does not undo a recorded physical handover or silently return permissions to the previous driver. The interface distinguishes handover recorded from anchor confirmed.

Personal details, locations, notes and photos remain in the approved South African data storage. Only hashes are anchored. Never attach substitutions to a fabricated exception merely to reuse an exception-only anchor mechanism.

The substitution itself is a normal custody event, including when unplanned. Evidence around it can raise existing exception types, such as a seal mismatch or location discrepancy, using the established evidence policy.

### Late uploads and offline behaviour

A former driver may upload evidence captured before transfer. Preserve the authenticated capturer, claimed capture time, server receipt time and custody context. A phone timestamp alone does not authorise retrospective phase completion. Late material needs a separate, explicit acceptance or review path that cannot advance the current trip on behalf of the replacement.

Retain rejected or uncertain evidence for attention with a specific reason and recovery action. Distinguish an actual duplicate from an ownership conflict. The reviewed offline queue removes terminal failures and treats 409 responses as duplicates; this behaviour must change for substitution-related failures so it does not silently discard evidence.

An offline handover confirmation remains pending until the server accepts it. The app must not claim that server ownership changed while disconnected. If a physical exchange occurred while a device was offline, record the discrepancy through the attributed dispatcher alternative or late-evidence process.

When takeover occurs during a partially completed phase, preserve each driver's captures separately. Do not silently submit the outgoing driver's unfinished local draft as the incoming driver's work or restart completed phases. The server reconciles accepted progress; conflicting drafts remain reviewable evidence.

### Missing confirmation and identity problems

Provide an explicitly authorised dispatcher alternative for a dead phone, injury or unreachable driver. Record the actual approving account, reason, available evidence and exactly which confirmations are missing. Never manufacture a driver's acknowledgement.

The proposed normal path requires authenticated participants and recorded identity outcomes. The team must decide whether a failed or unavailable external identity check blocks ordinary completion or permits a separately attributed dispatcher alternative. It must never be converted into a successful check.

Seal or location discrepancies remain visible and follow existing exception review rules. Substitution must not clear an existing hold or sign-off restriction. It records custody without adding route planning, physical dispatch control or hours-of-service management.

<!-- pagebreak -->

## 6 Blast radius and team coordination

The highest risk is changing who may act on a live trip while preserving the historical record. Several dozen production files plus tests may be involved. This is a scope estimate, not a completed file inventory.

| Area | Risk | Failure to prevent |
|---|---|---|
| Driver authorisation | Very high | Old driver still writes or replacement cannot continue |
| Availability and assignment | High | Double-booked replacement or incorrectly occupied outgoing driver |
| Offline evidence | High | Lost captures or old submissions changing later progress |
| Attribution and integrity | High | Wrong actor displayed or amendments omitted from verification |
| Driver app state | Medium to high | Stale working trip or missing incoming assignment |
| Dispatcher views and live updates | Medium | Stale driver names, duplicate requests or misleading completion |
| Analytics and audit exports | Medium | Whole journey incorrectly attributed to the original driver |

### Principal code areas

- **Trip model and services:** `backend/app/db/models/trips.py`, `backend/app/orchestration/trips/` and `backend/app/schemas/trips.py`.
- **Driver access and evidence:** `backend/app/orchestration/phases/loaders.py`, evidence services, handover services and associated route and manifest reads.
- **Verification and audit:** `backend/app/orchestration/verification/`, anchoring support and `backend/app/orchestration/audit_packs/`.
- **Availability and analytics:** `backend/app/orchestration/trips/availability.py`, trip listing queries and `backend/app/analytics/fleet/`.
- **Interfaces:** dispatcher trip detail and driver modal; driver trip context, detail, handover flows, push handling and offline queue; shared trip types and API clients.
- **Live updates and tests:** backend realtime events, frontend consumers, unit and integration tests, component tests and end-to-end scenarios.

These are impact areas, not permission to edit every file. Confirm the exact files and current sprint ownership before implementation.

### Ownership and shared files

Assign one feature owner for the substitution rules, data contract and integration. Agree changes to phase, evidence, availability and audit modules with their current owners. Other developers can take bounded interface or testing tasks after the contracts are stable; four developers do not make the elapsed time one quarter of the estimate.

If supporting models are added, `backend/app/db/models/__init__.py` is an explicitly shared file. Changes to configuration, dependencies or router registration also require the project's shared-file coordination. An existing trip-admin router may avoid a change to `main.py`; no new dependency is assumed by this spec.

### Delivery controls

Use Alembic for schema changes and follow the repository's migration coordination rules. Apply migrations only through the agreed shared-database process. Keep unrelated changes out of the feature.

Keep the feature unavailable to users until driver access rules and affected write paths work together. A fallback can disable new arrangements, but completed transfers must retain the correct current-driver resolution, permissions, history and verification. Simply removing the new screens or reverting to original-driver queries is not a safe fallback once real substitutions exist.

<!-- pagebreak -->

## 7 Effort and delivery stages

### Provisional effort

| Work area | Developer-days | Main work included |
|---|---|---|
| Lifecycle and backend endpoints | 2–3 | Data changes, arrangement, confirmations, completion, cancellation and alternatives |
| Permissions and availability | 2–3 | Shared driver rules, queries, reservations and concurrency |
| Dispatcher interface | 1–2 | Form, progress, history and timeline |
| Driver experiences and notices | 2–3 | Collection context, checks, assignment state and refresh |
| Integrity and integration | 3–4 | Anchoring, offline recovery, attribution, reporting and full regression |
| Total | 10–15 | Focused effort for one developer |

Testing belongs throughout these work areas. The final row of work includes cross-module integration and regression; it is not the first point at which testing starts.

Allow approximately 3–4 calendar weeks with integration, review and coordination. Push delivery, the late-evidence route, identity policy, historical access and metric attribution could increase the estimate. No device-delivery trial or implementation spike has yet removed those uncertainties.

### Proposed reviewable stages

1. **Participation and access contracts.** Define original, current, pending and former drivers, custody periods and shared queries. Establish regression coverage showing unchanged behaviour for trips without substitutions.
2. **Complete backend transfer.** Build the lifecycle, validations, availability, confirmations, dispatcher alternative and anchor support. Demonstrate a complete transfer through integration tests before exposing it in the apps.
3. **Dispatcher and driver interfaces.** Connect trip detail, collection information, driver checks, persistent notices, refresh and participation history.
4. **Integration and recovery.** Exercise offline uploads, competing requests, successive substitutions, incomplete phases, audit exports, analytics and anchor recovery. Complete the demonstration and documentation.

Each stage should end with evidence that the relevant behaviour works. Do not release a partial permission change independently of the write paths that depend on it.

### Scope boundary

The minimum complete version includes a genuine transfer, collection context, clear notices for both drivers, historical participation, safe permissions, availability, evidence preservation, verification and an honest missing-confirmation route.

Vehicle or trailer substitution, recurring exchange schedules, route optimisation, automatic dispatch, hours-of-service enforcement, a new chat system and broader notification-platform work are outside this feature. Existing vehicle and trailer identities are recorded at handover without introducing a separate vehicle-swap workflow.

If time is insufficient, defer FP-83 as a complete feature. Reducing visual polish is possible; removing custody confirmation, correct authorisation or evidence preservation changes the acceptance boundary and requires an explicit new scope decision.

<!-- pagebreak -->

## 8 Acceptance criteria and submission readiness

### Required acceptance scenarios

- **Normal transfer:** A dispatcher arranges A to B. Both drivers see the correct information and submit their own checks. B continues the same trip; A can no longer advance it.
- **History and attribution:** A's actions remain attributed to A. B's later actions remain attributed to B. A sees their participation history while the overall trip remains active.
- **Successive transfers:** A to B to C resolves C as current and preserves both completed amendments in order. Returning to a previously participating driver creates a new custody period.
- **Pending changes:** A material change invalidates affected confirmations and notifies both drivers. Cancellation preserves history, releases the pending claim and leaves A current.
- **Eligibility and isolation:** Inactive, wrong-organisation, invalid-licence and unavailable replacements are rejected under the agreed policy. Unrelated accounts cannot read or write the trip.
- **Concurrency and retries:** Competing substitutions, concurrent assignment and phase submission cannot create two current drivers or duplicate custody events. Retried requests return the existing result.
- **Offline evidence:** Pre-transfer captures are retained with their original actor and timestamps. An ownership conflict is distinguished from a duplicate and does not silently delete evidence or advance the trip.
- **Missing confirmation:** The authorised dispatcher alternative names the approver and reason and visibly preserves missing confirmation. Failed or unavailable identity checks remain accurately represented.
- **Current app state:** Outgoing pins and drafts do not remain actionable. The incoming assignment appears even when the driver previously had no trip. No driver must restart the app to discover a server-accepted change.
- **Evidence findings:** Seal or location discrepancies reach the existing review process without classifying substitution itself as an exception or silently clearing an existing hold.
- **Integrity and outages:** Original journey verification still passes; completed amendments and evidence verify independently. Anchor outages retain retryable work and do not reverse custody.
- **Reports and fallback:** Audit exports and driver reporting represent participation correctly. Disabling new arrangements preserves all previously completed transfers.

### Verification required before release

Run unit tests for current-driver derivation, chain continuity, payload determinism and eligibility logic. Run integration tests for each endpoint's success, authentication, validation, conflict and isolation paths, asserting database state after mutations. Run dispatcher and driver component tests plus the normal and failure-path demonstrations on supported clients.

Run the full backend suite and appropriate frontend regression checks under the repository's requirements. Specifically regress ordinary trips without substitutions, trip creation, activation, existing evidence upload, receiver handover and audit generation. Mobile background delivery must be tested on the actual supported device path if promised in the release.

### Go or defer

Proceed when the team confirms an owner, capacity against the submission date, the decisions in section 9, a coordinated integration sequence and a protected hardening period. Record the demonstration date and release cut-off before starting. If the remaining work exceeds that window, defer the feature rather than enabling an incomplete transfer.

<!-- pagebreak -->

## 9 Decisions for team confirmation

The following defaults are proposed for review. Approval of this document should confirm or amend them, rather than leave different developers to infer different rules.

| Decision | Proposed default or confirmation needed |
|---|---|
| Build before submission | Confirm submission date, available capacity and protected hardening period before accepting FP-83 |
| Accountable owner | Name one feature owner and confirm affected module owners |
| Approval authority | Any authorised dispatcher in the owning organisation; decide whether missing-confirmation completion needs an admin |
| Allowed trip states | ACTIVE and EXCEPTION_HOLD; no normal transfer on closed or cancelled trips |
| Transfer boundary | Server-accepted completion after the required checks; claimed earlier occurrence recorded separately |
| Driver confirmations | Both drivers on their own accounts and devices for the normal flow; explicit dispatcher alternative for unavailable confirmation |
| Identity failures | Confirm whether failed or unavailable external checks block ordinary completion or permit an attributed alternative |
| Former-driver visibility | Their participation and necessary supporting context; confirm exact fields and handling of later relevant findings |
| Pending reservation | One pending transfer per trip; reserve the replacement for the expected remaining assignment window using existing availability rules and cancel explicitly to release it |
| Late evidence | Preserve for an authorised review route; no automatic retrospective phase advancement from a former driver's timestamp |
| Notification promise | Persistent in-app notice is required; confirm native and browser background-delivery coverage before promising push on each client |
| Reporting scope | Attribute recorded events to their actors; explicitly label whole-trip metrics that cannot be divided fairly |

### Engineering choices left to the implementation plan

The builder may choose the supporting table layout, exact endpoint names, shared helper placement and UI component boundaries within these rules. The implementation plan must identify the precise files, lock order, migration, actor attribution changes, notice-delivery mechanism and recovery strategy. It must also settle how existing trips without participation records are represented without fabricating historical actors.

### Repository references

Paths are relative to the repository root. The implementation areas are listed in section 6.

- `CLAUDE.md` — architecture, privacy, testing and team workflow.
- `docs/known-issues.md` section 9b — original journey lock and anchored amendments.
- `docs/superpowers/specs/2026-09-23-exception-workflow-design.md` section 10 — proposed handover, seals and identity checks.
- `docs/meeting_minutes/Meeting_Minutes_Bruce_05May2026.md` section 9 — substitution as a normal event.

**Team outcome to record:** approve the proposed scope, approve with listed changes, or defer until after submission. Record the decision date, accountable owner and agreed release cut-off alongside that outcome.
