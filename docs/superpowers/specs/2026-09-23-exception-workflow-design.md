# Exception workflow — design

> **Status:** design approved in conversation 2026-09-23 · **Author:** Ciaran (drafted with Claude)
> **Next:** implementation plan (`docs/superpowers/plans/`), then build slice by slice.
> **Related:** [iteration 4 plan](../../iteration4_plan.md) §3, §5.3 · [research-informed recommendations](../../design-notes/2026-09-22-research-informed-iteration4-recommendations.md) P3, P4, P6 ·
> [known-issues §9b](../../known-issues.md#9b-driver-substitution) · [exception queue scaling](../../design-notes/2026-09-04-exception-queue-scaling.md) ·
> Tim's insurer audit trail plan (`Feat-ValueAddedDocumentation`, `docs/design-notes/2026-09-23-insurer-audit-trail-plan.md`, Stage 8)

---

## 0. Summary

Every exception gets reviewed. How urgently depends on its severity, and severity is
decided on the server by a **Python decision table**. Every exception records the rule
that classified it and a **fingerprint** of the rule set in force. Each rule-set version
is anchored to Hedera, so an insurer can check which rules classified an incident and
that they have not changed since.

Critical exceptions go to the live queue and are anchored when raised. They block the
trip's **evidence sign-off**, a new dispatcher action, but they never block the driver.
Warnings must also be reviewed before sign-off, but can be reviewed in a batch. The driver
gets a clearer picker with five new options, including **"Something else"**. A dispatcher
must classify every "Something else" report during review.

Decisions taken in the design conversation:

| # | Decision |
|---|---|
| D1 | Critical exceptions block trip **sign-off** (option B). The driver is never blocked. |
| D2 | Severity is decided by a deterministic Python decision table, not an AI model or an external rules engine. AI decision models (Jev, Kev) were considered and rejected: they are probabilistic, not reproducible, and Jev is hosted outside SA (POPIA). GoRules ZEN was the runner-up and was rejected as a new dependency with little gain at ~30 types. |
| D3 | The rule-set fingerprint is stored on every exception and each new version is anchored. |
| D4 | Cargo damage is always critical. Route deviation starts as a warning, and a dispatcher can upgrade it. |
| D5 | Driver substitution is not an exception. It is a custody amendment event (§10), built separately under FP-83. |

---

## 1. What exists today (verified on `dev` at `afd93fd`)

- **Driver picker** ([LogExceptionPageClient.tsx](../../../frontend/driver-pwa/app/(app)/trip/in-transit/exception/LogExceptionPageClient.tsx)):
  delivery refused, cargo damage, seal broken in transit, vehicle breakdown (horse *or*
  trailer, single-select), document issue. Panic has its own flow. There is no "other"
  option. The list comes from `DRIVER_EXCEPTION_TYPES` in `frontend/shared/lib/constants/status-meta.ts`.
- **The backend does not enforce that list.** `DriverExceptionCreateBody.exception_type`
  accepts any `ExceptionType`, so a driver can POST `gps_mismatch` or `dispatcher_note`.
- **Severity is scattered across the code.** It lives in `_CRITICAL_TYPES` in
  `exception_service.py`, a copy in `driver-pwa/lib/context/TripContext.tsx`
  ("keep in sync"), seven hard-coded sites in `phase_service.py`, and two in
  `receiver_verification_service.py` / `action_location_service.py`.
- **Review status:** `initial_review_status()` sends CRITICAL to `needs_review`. Everything
  else goes to `recorded` and is never reviewed. The live queue is deliberately
  unpaginated because it holds only `needs_review` rows.
- **Review** is one-shot and immutable, with 5 outcomes and a contact method.
  `referred_for_follow_up` is a dead end: nothing records the follow-up.
- **Dispatcher-raised types:** `escalation` and `trip_hold` are never created anywhere.
  `dispatcher_note` is only written automatically by phase override and trip cancellation.
  There is no endpoint for a dispatcher to raise an exception.
- **Declared but never raised:** `route_deviation`, `checkpoint_timeout`, `sequence_violation`,
  `vehicle_substitution`, `driver_substitution`.
- **Trips close automatically** when the last phase resolves
  ([phase_service.py:344](../../../backend/app/orchestration/phase_service.py:344)).
  `TripStatus.EXCEPTION_HOLD` exists but nothing sets it.
- **Anchoring:** exceptions are never anchored. `exceptions.gps_lat/lng` carry a model
  comment forbidding any hash or anchoring path. Phase anchors are dispatched through
  Celery with a recovery sweep (`tasks/blockchain.py`, `phase_service._dispatch_anchor`).

Research transcripts were not consulted: macOS privacy settings blocked access to the
OneDrive folder. The new catalogue entries come from the Bruce minutes (26 Mar, 5 May),
TAPA TSR 2023 and the GIT claim-form research in Tim's plan. **Revisit §3 once the
transcripts are reviewed.**

---

## 2. Severity model

### 2.1 Tiers

| Tier | Meaning | Initial `review_status` | Review | Sign-off | Anchored |
|---|---|---|---|---|---|
| **Critical** | Meets at least one criterion in §2.2 | `needs_review` | Live queue, one at a time | Blocks | When raised, and when reviewed |
| **Warning** | Worth a human look | `needs_review` | Trip's "to review" list; batch review allowed | Blocks until reviewed (batch counts) | No |
| **Info** | Authored by a dispatcher, who is therefore its reviewer (override and cancellation notes) | `recorded` | None | Does not block | No |

`recorded` keeps its existing meaning ("no review workflow item"), now only for info rows
and legacy rows. No new review status is added.

### 2.2 The critical test

An exception is **critical** if it signals any of:

- **(a)** a person may be hurt or in danger
- **(b)** cargo may be lost, stolen, or reached by someone outside the custody chain
- **(c)** the goods went to, or were taken by, the wrong party
- **(d)** the trip cannot finish as planned

The rule of thumb: *would an insurance claim, a police case or a custody dispute depend on
it?* Each critical rule in the table names its criterion. The criterion is stored on the
exception and printed in the audit pack.

### 2.3 Upgrading, never downgrading

- A dispatcher may upgrade **warning → critical**, with a required reason.
- The original severity is kept, and the upgrade is anchored.
- Nobody can downgrade. A critical false alarm is settled by reviewing it with outcome
  `no_action_required`, so the original signal stays visible.

---

## 3. Catalogue

"Today" is the current severity, where the type is raised at all. New types are string
enum values on a `String(50)` column, so no DB enum migration is needed.

### 3.1 Driver-raised (picker order)

| # | Picker label | `ExceptionType` | Driver answers | Rule → severity (criterion) | Today |
|---|---|---|---|---|---|
| 1 | Panic (own flow) | `panic_button` | — | always → critical (a) | critical |
| 2 | Accident / collision | `collision` **new** | Anyone hurt? Can the trip continue? | hurt → critical (a); can't continue → critical (d); else warning | — |
| 3 | Vehicle breakdown | `mechanical` | Which vehicles (**multi-select** horse/trailers)? Can the trip continue? | can't continue → critical (d); else warning | warning |
| 4 | Seal broken or tampered | `seal_broken_in_transit` | — | always → critical (b) | critical |
| 5 | Cargo damaged | `cargo_damage` | — | always → critical (b) | warning |
| 6 | Delivery refused | `delivery_refused` | — | always → critical (d) | warning |
| 7 | Driver unwell | `driver_unwell` **new** | Can the trip continue? | can't continue → critical (a); else warning | — |
| 8 | Stopped by police / roadblock | `police_stop` **new** | — | warning. Fake roadblocks are a known hijack method, so dispatchers should consider an upgrade | — |
| 9 | Road closed / unrest / delay | `road_disruption` **new** | — | warning (TAPA 9.19.3 route-change record) | — |
| 10 | Document problem | `document_review` | — | warning | warning |
| 11 | Something else | `other` **new** | Anyone hurt? Can the trip continue? Description required | hurt → critical (a); can't continue → critical (d); else warning | — |

The two questions are asked only where the table uses them. An unanswered question is
treated as the worse answer (hurt / cannot continue) for severity purposes, and is stored
as unanswered (`NULL`), never as "no". The backend enforces this list; any other type from
the driver endpoint returns 422.

### 3.2 System-raised

| `ExceptionType` | Rule → severity (criterion) | Today | Note |
|---|---|---|---|
| `seal_mismatch` | always → critical (b) | critical | |
| `seal_unverified` | absence unexplained → critical (b); explained → warning | same | Keeps the current `absence_is_explained` rule |
| `parcel_count_mismatch` | short → critical (b); over or direction unknown → warning | warning | Needs the count delta at the raise site |
| `waybill_count_mismatch` | warning | warning | |
| `gps_mismatch` | warning | warning | |
| `driver_vehicle_separation` | warning | warning | |
| `driver_location_mismatch` | warning | warning | |
| `route_deviation` | warning (D4) | not raised | Upgradeable; waits on a Pulsit route feed |
| `checkpoint_timeout` | warning | not raised | |
| `sequence_violation` | warning | not raised | |
| `receiver_id_mismatch` | always → critical (c) | warning | **Deliberate change.** The old docstring reserved critical for "findings that stop a trip". The new definition is evidential, not operational. Verification still never gates a delivery |
| `receiver_id_unverified` | warning | info | Info is now reserved for dispatcher-authored rows |
| `vehicle_substitution` | warning | not raised | Future amendment, same pattern as §10 |

### 3.3 Dispatcher-raised

| `ExceptionType` | Raised by | Rule → severity |
|---|---|---|
| `dispatcher_note` | Automatic: phase override, trip cancellation | info |
| `dispatcher_report` **new** | A dispatcher, through a new endpoint, for things seen outside the system (a client phones in, a tracker alert seen in the tracking company's own system) | The dispatcher picks warning or critical and must name a criterion for critical. The floor is warning |

### 3.4 Removed

- `escalation`, `trip_hold`: dead values. Delete them from the backend enum and the shared
  frontend list **after Ciaran confirms** `SELECT count(*) FROM exceptions WHERE exception_type IN ('escalation','trip_hold')` returns 0 on the shared DB.
- `driver_substitution`: removed from `SYSTEM_EXCEPTION_TYPES` and the catalogue. The enum
  value stays, because `DriverSubstitution.exception_id` and old analytics may reference
  it. See §10.

---

## 4. The decision table and fingerprint

### 4.1 Shape

New pure module `backend/app/orchestration/exception_policy.py`. It has no DB access and
no I/O.

```python
class Criterion(str, Enum):           # (a)–(d) from §2.2
    PERSON_AT_RISK = "person_at_risk"
    CARGO_EXPOSED = "cargo_exposed"
    WRONG_PARTY = "wrong_party"
    TRIP_CANNOT_FINISH = "trip_cannot_finish"

class Condition(str, Enum):           # closed set of named predicates, so the table serialises
    ALWAYS = "always"
    ANYONE_HURT = "anyone_hurt"
    CANNOT_CONTINUE = "cannot_continue"
    COUNT_SHORT = "count_short"
    SEAL_ABSENCE_UNEXPLAINED = "seal_absence_unexplained"
    DISPATCHER_CHOSE_CRITICAL = "dispatcher_chose_critical"

@dataclass(frozen=True)
class Rule:
    rule_id: str                      # stable, e.g. "collision.hurt"
    exception_type: ExceptionType
    when: Condition
    severity: ExceptionSeverity
    criterion: Criterion | None       # required when severity is CRITICAL

@dataclass(frozen=True)
class ExceptionFacts:                 # everything a rule may look at
    exception_type: ExceptionType
    source: ExceptionSource
    anyone_hurt: bool | None
    can_continue: bool | None
    count_delta: int | None           # expected − actual; > 0 is short
    seal_absence_explained: bool | None
    dispatcher_severity: ExceptionSeverity | None

@dataclass(frozen=True)
class Classification:
    severity: ExceptionSeverity
    criterion: Criterion | None
    rule_id: str
    policy_fingerprint: str

RULES: tuple[Rule, ...] = (...)      # ordered; first match per type wins; each type ends with a catch-all
def classify(facts: ExceptionFacts) -> Classification: ...
def allowed_types(source: ExceptionSource) -> frozenset[ExceptionType]: ...
```

- Conditions are **names**, not lambdas. The table is plain data, so it serialises to
  canonical JSON and can be printed in the audit pack. `_PREDICATES: dict[Condition, Callable[[ExceptionFacts], bool]]`
  maps each name to its evaluation.
- `allowed_types()` is the single source of truth for who may raise what. The driver
  endpoint, the dispatcher endpoint and the shared frontend list all follow it.

### 4.2 Fingerprint

- `policy_fingerprint = sha256(canonical_json({"engine": POLICY_ENGINE_VERSION, "rules": RULES}))`,
  using the existing `canonicalize_payload`.
- `POLICY_ENGINE_VERSION` is an integer constant, bumped by hand whenever a predicate's
  *meaning* changes, because predicate code is not part of the serialised table.
- It is computed once at import.

### 4.3 Persisting and anchoring versions

New table `exception_policy_versions`:

| Column | Notes |
|---|---|
| `fingerprint` | Primary key, 64 characters |
| `engine_version` | |
| `rules_json` | JSONB: the full table |
| `anchor_status` | |
| `blockchain_receipt_id` | |
| `created_at`, `updated_at` | |

- **Registered lazily.** The first exception classified under an unseen fingerprint
  inserts the row (`ON CONFLICT DO NOTHING`) and queues its anchor. Nothing is written at
  startup, so no deploy-time DB work is needed.
- An insurer, or the audit pack, can resolve any exception's fingerprint to the exact
  rules that classified it.

### 4.4 Exception columns (one migration)

| Column | Type | Meaning |
|---|---|---|
| `severity_criterion` | `String(30)`, nullable | Criterion that made it critical |
| `severity_rule_id` | `String(60)`, nullable | Rule that matched |
| `policy_fingerprint` | `String(64)`, nullable, FK → `exception_policy_versions` | Rules in force. `NULL` = legacy row, classified before the table existed |
| `initial_severity` | `String(20)`, nullable | Set only when upgraded |
| `escalated_by_user_id`, `escalated_at`, `escalation_reason` | nullable | Upgrade record |
| `reported_type` | `String(50)`, nullable | Driver's original choice when a dispatcher classifies an `other` report; `exception_type` then holds the classification |
| `classified_by_user_id`, `classified_at` | nullable | Classification record |
| `anyone_hurt`, `can_continue` | `Boolean`, nullable | Driver's answers; `NULL` = not asked or unanswered |
| `anchor_status`, `blockchain_receipt_id` | nullable | Critical-exception anchor (§8) |

Breakdown multi-select needs `exception_vehicles` (`exception_id`, `vehicle_id`, PK both),
replacing the single `vehicle_id` for new rows. The old column stays readable for history,
and analytics keeps reading it as a fallback.

### 4.5 Wiring

- Every exception creation site builds `ExceptionFacts`, calls `classify()`, and writes
  severity, criterion, rule id and fingerprint. `initial_review_status()` then derives
  from the tier.
- That covers `exception_service`, the seven `phase_service` sites,
  `receiver_verification_service`, `action_location_service` and `trip_service.cancel_trip`.
  Hard-coded `ExceptionSeverity.*` at those sites is deleted.
- The `phase_service` edits are one-line swaps, done in a quiet window, since it is the
  most-shared file.
- The driver app stops computing severity. Its optimistic row shows "sending…" until the
  server response supplies severity.

---

## 5. Review workflow and sign-off

### 5.1 Lists

| List | Contents | Pagination |
|---|---|---|
| **Live queue** (`/exceptions`) | `needs_review` and **critical** | Unpaginated, as the queue-scaling note decided |
| **To review** (organisation) | `needs_review` and warning | Cursor-paginated. Extend `list_exception_history` to accept this filter instead of adding an endpoint |
| **Trip "to review"** (trip detail) | Every `needs_review` row on the trip | Bounded per trip |

**Counts:** `needs_review_count` on trip rows splits into `critical_open_count` and
`to_review_count`. The driver app shows critical only, since the driver has no review
action.

### 5.2 Review actions

| Action | Who | Rules |
|---|---|---|
| Review one | Any dispatcher (existing role) | Unchanged: immutable, first review wins. An `other` report must be classified in the same request (§6). Reviewing a critical exception queues an anchor |
| Batch review | Any dispatcher | Warnings only, all on one trip. One outcome and note, but a review is written **per row** with the same reviewer and time. Critical rows are rejected (422) |
| Upgrade | Any dispatcher | Warning → critical with a reason. Moves the row into the live queue, and queues an anchor |
| Follow-up note | Any dispatcher | Append-only row on a **reviewed** exception (an inspection result, SAPS feedback). Never edits the review. New table `exception_followups` (`id`, `exception_id`, `author_user_id`, `note`, `created_at`, `updated_at`). Not anchored in v1 |

### 5.3 Evidence sign-off (the D1 gate)

- **Automatic closure is unchanged.** The trip still becomes `closed` when its last phase
  resolves, so the ledger stays the truth.
- **New action: "Sign off evidence".** A dispatcher can use it only when the trip is
  `closed` or `cancelled` **and** no exception on it is `needs_review`. Otherwise it
  returns 409 with the counts. Legacy `recorded` rows do not block.
- **Storage:** a new append-only table `trip_evidence_signoffs`, not columns on `trips`,
  which is in the journey lock and on every branch.
  - Columns: `id`, `trip_id`, `sequence`, `signed_off_by_user_id`, `signed_off_at`,
    `exception_count`, `critical_count`, `anchor_status`, `blockchain_receipt_id`, timestamps.
    Unique on (`trip_id`, `sequence`).
  - It is anchored.
- **Display:** trip lists show "Delivered · 2 to review" or "Signed off". The audit pack
  shows sign-off status, and "not signed off" when absent.
- **Late exceptions:** an exception raised after sign-off (a late discrepancy, P4) marks
  the trip "new since sign-off". Once it is reviewed, a second sign-off is recorded with
  the next `sequence`. The first sign-off is never altered.

---

## 6. "Something else"

1. The driver picks **Something else**, writes a description (required, minimum 10
   characters), answers the two questions, and can add a photo.
2. The table classifies it on the answers: hurt or cannot continue → critical, otherwise
   warning.
3. On review, the dispatcher must choose the real type from `allowed_types(DRIVER)`, or
   confirm `other`.
   - `reported_type` keeps `other`.
   - `exception_type` becomes the classification.
   - Severity becomes `max(current, classify(new facts))`. Classifying can never lower it.
4. **Signal for the catalogue:** a count of `reported_type = 'other'` grouped by
   classification, shown in the exception history filters and as a slide. A recurring
   classification is the prompt to add a picker option.

---

## 7. Driver-app and dispatcher-app changes

- **Driver picker:** the 11 entries in §3.1, in that order.
  - Contextual questions appear only for their types.
  - Breakdown uses multi-select vehicles.
  - Labels come from a shared label map (`frontend/shared`, **coordinate**), and the type
    list comes from the same source as `allowed_types()`. A test asserts the backend and
    shared lists match.
- **Driver offline queue:** new fields are optional. An older client that omits them gets
  the worse answer (§3.1). Existing `client_report_id` idempotency is unchanged.
- **Dispatcher:**
  - Live queue filtered to critical.
  - A "To review" tab.
  - Batch review on the trip panel.
  - An upgrade button.
  - An `other` classification step inside the review form.
  - Follow-up notes on reviewed exceptions.
  - A "Sign off evidence" button with a blocking-count explanation.
  - Severity chips show the criterion (e.g. "Critical · cargo exposed").

---

## 8. Anchoring (completes Tim's Stage 8)

- **New `SubjectType.EXCEPTION`** and receipt types: `EXCEPTION_RAISED`,
  `EXCEPTION_ESCALATED`, `EXCEPTION_REVIEWED`, `TRIP_EVIDENCE_SIGNED_OFF`,
  `EXCEPTION_POLICY_PUBLISHED`. Coordinate with Tim: his branch adds `SubjectType.AUDIT_PACK`
  to the same enum and `subject_visibility.py`.
- **What gets anchored:** critical exceptions at raise, every upgrade, reviews of critical
  exceptions, each sign-off, and each new policy version.
- **How:** through Celery with a recovery sweep, the same pattern as phase anchors. A panic
  report must never wait 4–6 s for Hedera. The policy is fail-open: the exception persists,
  `anchor_status = failed` is shown and retried, and is never rendered as success.
- **Exception payload v1:** `exception_id`, `trip_id`, `exception_type`, `source`,
  `severity`, `severity_criterion`, `severity_rule_id`, `policy_fingerprint`,
  `description_sha256`, `supporting_artifact_sha256`, `created_at`.
  - **No GPS, and no description text.** This keeps the POPIA rule on
    `exceptions.gps_lat/lng` unchanged. Only hashes go to Hedera.
  - Actor fields follow the existing fleet-mutation payload convention (verify in the plan).
- **Verification:** `verify_subject` and `subject_visibility` gain the `EXCEPTION` case,
  so the existing verify UI works for exceptions.
- **Audit pack:** Tim's builder marks anchored exceptions as tier "anchored", and shows
  policy fingerprint and sign-off.
- **Optional S5 extra:** anchor trip cancellation (P6), only if S5 lands early.

---

## 9. Slices, dependencies and acceptance

| Slice | Content | Depends on | Acceptance |
|---|---|---|---|
| **S1** Policy | `exception_policy.py`, fingerprint, migration (columns, `exception_policy_versions`, `exception_vehicles`), all creation sites call `classify()` | Tim's migration merged (single head) | Every `ExceptionType` has a terminal rule (exhaustiveness test); every row in §3 has a unit test; fingerprint is stable (golden value) and changes when any rule changes; integration: each raise site stores severity, criterion, rule id and fingerprint |
| **S2** Catalogue | New types, driver allowlist (422), multi-select breakdown, contextual questions, dead-value removal after the DB check | S1 | Driver POST of a system type → 422; unanswered question → critical and stored `NULL`; shared list equals `allowed_types(DRIVER)` |
| **S3** Review and sign-off | Queue split, counts, batch review, follow-ups, `trip_evidence_signoffs` | S1 | Queue returns critical only; batch rejects critical; sign-off 409 with open items and 201 when clear; late exception after sign-off shows "new since sign-off"; DB state asserted after every mutation |
| **S4** Dispatcher actions | `dispatcher_report` endpoint, upgrade, `other` classification | S1, S3 | Upgrade only warning → critical; downgrade → 422; classification never lowers severity; `reported_type` preserved |
| **S5** Anchoring | Receipt and subject types, Celery tasks and recovery, verification | S1; Tim merged | Anchor dispatch captured with payload v1; no GPS or description text in any payload; failure leaves the row with `anchor_status=failed`; recovery re-dispatches |
| **S6** Screens | Driver picker, dispatcher queue, tabs, forms, sign-off | S2–S4 | Vitest per component; browser check of raise → review → sign-off on the demo trip |

**Suggested order:** S1 → S2 and S3 in parallel → S4 → S5 → S6. The driver picker (S6
driver half) can start after S2's API lands.

**Sizing:** rough, and for the team to estimate: S1 5, S2 5, S3 8, S4 5, S5 8, S6 8 → about 39 points.

**Build rules:**
- One hand-written migration, `<date written>_ciaran_exception_policy.py`, based on Tim's
  head after merge. Pruned per CLAUDE.md, never upgraded from a feature branch, and run by
  Ciaran from `dev`.
- New tables get RLS/REVOKE in the same migration (security S1 pattern).
- Tests are unit and integration per slice.

**Shared files touched:** `db/models/enums.py`, `db/models/__init__.py`, `main.py` (if a
router is added), `frontend/shared/lib/constants/status-meta.ts` and shared exception
types, `phase_service.py` (severity call sites only).

---

## 10. Driver substitution: how it could and should work (future, FP-83)

**Not built by this spec.** Recorded so the exception work leaves room for it.

### 10.1 What we know

- **Bruce (5 May):** substitutions are a known operational event and "should be recorded
  as such… not flagged as an exception".
  - Exchange points are pre-agreed in the SLA and geofenced in Pulsit. Harrismith is the
    JHB–DBN exchange in both directions.
  - Log the original driver, the substituting driver, the exchange location and the
    approving dispatcher.
- **Bruce (24 Jun):** one driver runs both legs about 80% of the time. Otherwise it is two
  drivers or a scheduled stopover, under time-and-duty rules.
- **The driver is inside the journey lock** (`compute_journey_lock_hash`). Mutating
  `trip.driver_id` correctly reads as tampering.
- **Direction agreed 9 Sep** ([known-issues §9b](../../known-issues.md#9b-driver-substitution)):
  an anchored amendment on the ledger. The original lock stays valid, and verification
  checks the original plus the ordered amendment chain. The rejected option (close and
  re-create the trip) fragments one physical journey across two records.
- **Already in the code:**
  - The `DriverSubstitution` model (original and substituting driver, exchange location,
    approving dispatcher, `is_planned`, `substitution_at`, `exception_id`,
    `blockchain_receipt_id`) exists but is unused.
  - `trip_location_pings.driver_id` is already stored per ping for this reason.

### 10.2 Proposed flow

1. **Approval.** A dispatcher records the substitution: incoming driver, exchange point
   (precinct if geofenced, else free text), and planned or unplanned. The dispatcher is the
   approver, which the model requires. A planned exchange can be put on the trip at
   creation as an expected exchange, so the event matches a plan item.
2. **Handover between drivers.** This is the custody moment and the evidential core.
   - The outgoing driver's app shows "Hand over", with a seal check (number + photo).
   - The incoming driver's app shows "Take over", with their own seal check.
   - Both captures carry the usual location assessment. Each driver acts only on their own
     device.
3. **Amendment.** The server writes the `DriverSubstitution` row, anchors it as an
   amendment (outgoing, incoming, approver, time, exchange point, both seal-check hashes),
   and switches which driver the trip currently belongs to.
   - `trips.driver_id` is **not** overwritten. The current driver is **derived** from the
     original plus the amendment chain, the same way position is derived from the ledger.
   - Auth and trip listing read the derived value.
4. **Identity.** The incoming driver passes the same identity check as at activation.
   `trips.idvs_check_status` becomes per-driver-stint.
5. **Timeline.** If it happened during a phase (usually `in_transit`), it is rendered
   inside that phase as a custody event (`phase_event_id` set). Otherwise it is a
   trip-level event in the "Trip record" section. It is never shown as an exception chip.
6. **Verification.** `verification_service._reconstruct_trip_payload` rebuilds the
   original and applies amendments in order. The integrity summary reads "matches, with N
   recorded amendments". It needs tests, including two successive substitutions.

### 10.3 When a substitution *does* produce an exception

The substitution itself never does. The **decision table** raises exceptions from the
evidence around it, using existing types:

| Situation | Exception |
|---|---|
| Seal numbers differ between hand-over and take-over | `seal_mismatch`, critical (b) |
| Exchange happened outside the planned exchange geofence | `driver_location_mismatch`, warning |
| Unplanned substitution | No exception. The event carries `is_planned=false`, which is visible and filterable. Bruce's guidance is that it is an operational event |
| Incoming driver failed identity check | Handled like the activation identity failure |

This keeps D5 and Bruce's rule, while any evidence that custody broke at the exchange
still reaches the review queue.

### 10.4 Open questions for that spec

- Who may approve: any dispatcher, or admin only?
- What happens if the outgoing driver is unreachable, or their phone is dead? A dispatcher
  "take over on behalf" with a reason, recorded as such?
- Does a trailer or horse swap (`vehicle_substitution`) use the same amendment mechanism?
  Almost certainly yes. Scope them together.
- Are hours-of-service implications recorded? Out of scope per the iteration 4 plan's
  deferred list.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Warnings now need review → more dispatcher work | Batch review per trip; live queue stays critical-only |
| Analytics mix old and new severities across the deploy boundary (e.g. `cargo_damage` warning → critical) | `policy_fingerprint IS NULL` marks legacy rows; analytics tiles state the boundary. No backfill, since rewriting stored severities would rewrite evidence |
| `phase_service.py` conflicts across branches | Severity edits are one-line swaps; land them straight after a merge to `dev` |
| Enum conflicts with Tim's branch (`SubjectType`, receipt types) | S5 starts after Tim merges |
| Receiver mismatch becoming critical contradicts the earlier "never critical" rationale | Called out in §3.2; the new definition is evidential. Update that docstring in S1 |
| Old driver clients without new fields | Missing answers classify as the worse case; nothing is rejected |
| Research transcripts not yet reviewed | §3 marked revisable; the new types are additive |
