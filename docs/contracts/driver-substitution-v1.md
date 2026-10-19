# Driver substitution API contract v1

**Owner:** Ciaran. **Driver-app consumer:** Tim. **Status:** planned contract, revised after source review; these endpoints and fields are not implemented yet.

This contract accompanies the [implementation plan](../superpowers/plans/2026-10-18-driver-substitution.md) and [Tim's handoff](../superpowers/plans/2026-10-18-driver-substitution-driver-app.md). Read `CLAUDE.md` before implementation. Ciaran owns backend schemas and `frontend/shared`; Tim owns `frontend/driver-pwa`. Contract changes must update the shared types, fixtures and both plans together.

## Confirmed product rules

- Any dispatcher in the trip's organisation may arrange, cancel, replace, or complete a handover with missing confirmation. Missing confirmation requires a reason and is never represented as a driver's acknowledgement.
- Use the incoming driver's authenticated account and existing fleet verification record. A VERIFIED record is required for normal completion. An admin dispatcher may attest unavailable verification (PENDING), with a separate reason. FAILED identity is not overridden by this permission. Never change a failed or pending result to VERIFIED.
- No supported production driver-verification writer has been identified. C0 records the source of genuine VERIFIED records, if any. Until a real supported source exists, PENDING drivers use the approved admin-exception path; do not fabricate VERIFIED records or reuse receiver verification. A new fleet-verification workflow is outside FP-83.
- Incoming `license_expiry` must be present and at least the expected exchange date in SAST when arranging/replacing; recheck against the actual server-effective completion date in SAST. Expiry on that date is valid through the day. Null/expired dates block takeover without an override.
- Persistent in-app notices and automatic refresh are required. Background push is excluded from v1 acceptance; existing native permission/registration does not prove a working server delivery path.
- Normal handover is on ACTIVE or EXCEPTION_HOLD trips. Transfer does not clear an existing hold or change phase progress.
- Original `Trip.driver_id` never changes. Only a completed substitution changes the derived current driver. Server completion time is the effective transfer time; a claimed earlier physical exchange is a separate fact.

## Common wire rules

All paths below have `/api/v1` prefixed. Use existing bearer authentication, rate limits and typed API clients. Actor IDs always come from the token, never request bodies. UUIDs are strings, dates are ISO 8601 with an explicit offset, and coordinates are JSON numbers. Display dates in SAST.

Collection routes have no trailing slash; a table suffix `/` means the router prefix itself. Do not depend on a redirect for POST requests.

All new substitution and late-evidence state-changing requests except marking a notice read carry `client_request_id: UUID`. Existing live-write endpoints keep their existing idempotency field names. The server scopes new keys to actor and action, stores a request-body digest, and returns the existing result for an exact retry. Reusing a key with different content is a conflict. Authentication, tenant and actor checks precede replay; an exact successful replay precedes stale-version checks.

`expected_version: int >= 1` is required for actions on an existing pending request. Its version advances on accepted confirmations and terminal changes. An identical retry does not increment it. A stale version causes a refetch, never a silent overwrite.

## Types to publish in frontend shared

Create `frontend/shared/lib/types/driver-substitution.ts`. Pydantic schemas live in `backend/app/schemas/driver_substitutions.py`.

| Type | Fields and meaning |
|---|---|
| `SubstitutionState` | `pending`, `completed`, `cancelled` |
| `SubstitutionRole` | `outgoing`, `incoming` |
| `DriverContact` | `id`, `full_name`, `phone_number`; no identity number, licence number or verification vendor data |
| `ExchangePoint` | `label` (1–255 chars), `latitude` (-90 to 90), `longitude` (-180 to 180), `instructions` (0–1000 chars) |
| `VehicleRef` | `id`, `registration`, `vehicle_type` using existing vehicle values |
| `SubstitutionSealCondition` | `intact`, `damaged`, `missing`, `not_applicable`; separate from ordinary-phase `SealCondition` |
| `SealCheck` | `vehicle_id`, `condition: SubstitutionSealCondition`, `seal_number: string or null`, `photo_artifact_ids: UUID[]`, `not_applicable_reason: string or null` |
| `IdentitySnapshot` | `driver_id`, `status` (`verified`, `pending`, `failed`), `last_verified_at: datetime or null`, `observed_at`; optional admin attestation is a separate object |
| `ConfirmationSummary` | `id`, `role`, `driver_id`, `captured_at`, `received_at`; evidence content is available only through the permitted context read |
| `SubstitutionRequestRead` | `id`, `trip_id`, `trip_reference`, `version`, `state`, `outgoing`, `incoming`, `vehicles`, `exchange`, `expected_at`, `is_planned`, `reason`, `created_at`, `confirmations`, `identity`, `missing_confirmations: SubstitutionRole[]`, `completed_substitution_id: UUID or null`, `effective_at: datetime or null`, `completion_mode: normal or dispatcher_attested or null`, `completion_blocked_by: incoming_driver_inactive or licence_invalid or driver_unavailable or identity_not_verified or null`, `replacement_request_id: UUID or null`, `completion: SubstitutionCompletionRead or null`, `permitted_actions: SubstitutionAction[]` |
| `SubstitutionAction` | `confirm_outgoing`, `confirm_incoming`, `cancel`, `replace`, `complete_attested`, `attest_identity` |
| `SubstitutionCompletionRead` | `trigger: driver_confirmation or dispatcher_action`, `completed_by_driver_id: UUID or null`, `completed_by_user_id: UUID or null`; exactly one actor on new completed records; no dispatcher-only attestation reasons in driver responses |
| `CustodyIntegrityRead` | `status: verified or pending or failed`, `amendment_count: int`, `pending_anchor_count: int`, `findings: string[]`; dispatcher-only verification result |
| `DriverAccess` | `participation: current or former`, `custody_sequence: int`, `can_advance: bool`, `can_submit_late_evidence: bool` |
| `SubstitutionNoticeRead` | `id`, `request_id`, `trip_id`, `kind` (`arranged`, `cancelled`, `completed`), `created_at`, `read_at: datetime or null`; details require an authorised fetch |
| `SubstitutionCorrectionRead` | `id`, `substitution_id`, `recorded_by_user_id`, `recorded_at`, `reason`, `correction_note`, `anchor_status`, `receipt_id: UUID or null`; an appended clarification, never an edit or a new custody assignment |

`SubstitutionRequestRead` is an explicit response schema, not a raw ORM dump. `permitted_actions` may contain `confirm_outgoing`, `confirm_incoming`, `cancel`, `replace`, `complete_attested`, `attest_identity`. It guides presentation; the server independently enforces each action. Driver responses exclude dispatcher-only reasons and evidence outside that driver's allowed context. Dispatcher detail also exposes `arranged_by_user_id` and identity-attestation author/reason/server time; the original arranger, each driver confirmer, completing actor and identity-attesting admin are distinct facts. Identity status remains PENDING when an admin exception is used. Existing trip-level identity fields describe the original journey snapshot, not every later driver.

For a loaded trip, require seal checks on each trailer, or on the horse if there are no trailers. For `intact`/`damaged`, require the seal number and at least one photo; normalise and validate numbers with the existing phase rule `^[A-Z]{2}-\d{4}$` (for example `AB-1234`). For `missing`, require a null number and at least one photo documenting absence. For an empty leg, allow `not_applicable` with `not_applicable_reason` of 1–1000 non-whitespace characters, null seal number and optional photos; otherwise the reason must be null. Require one check per applicable vehicle and reject duplicate vehicle checks. Do not broaden the existing ordinary-phase enum or fabricate a seal. Both drivers separately submit `confirmed_vehicle_ids` covering the complete assigned horse/trailer set; they cannot name unrelated vehicles. Seal disagreements create evidence findings, not a fabricated substitution exception.

`DriverSubstitutionContextRead` extends the request read with ordered `remaining_stops` using the existing driver-safe stop shape, `current_phase: PhaseType or null`, current relevant findings using the existing driver-safe exception summary, and `artifacts: EvidenceArtifactWithUrl[]`. Its `confirmations` extend the summary with `seal_checks` and the permitted declaration fields. Only submitted confirmations appear in the array; an upload is not confirmation. Signed URLs follow existing expiry and authorised scope rules. Former participants use the restricted participation response instead of this ongoing collection context.

A cancelled/replaced request's named recipients may still read their arrangement snapshot to understand its notice. Return no subsequent live progress, tracker position or unrelated findings in that case. A completed outgoing driver's notice links to participation history, not unrestricted collection context.

Backend request model names are `ArrangeSubstitutionRequest`, `CancelSubstitutionRequest`, `ReplaceSubstitutionRequest`, `ConfirmSubstitutionRequest`, `CompleteSubstitutionRequest`, `CorrectSubstitutionRequest`, `LateEvidenceRequest` and `AcknowledgeLateEvidenceRequest`, matching the endpoint body fields below. Publish corresponding TypeScript interfaces in the shared type file.

## Dispatcher endpoints

New `dispatcher_router` in `backend/app/api/v1/endpoints/driver_substitutions.py`, prefix `/trips/{trip_id}/driver-substitutions`.

| Method and suffix | Body | Response |
|---|---|---|
| `POST /` | `client_request_id`, `incoming_driver_id`, `exchange`, `expected_at`, `is_planned`, `reason` (1–1000 chars) | 201 `SubstitutionRequestRead`; an exact replay returns the same request |
| `GET /` | None | 200 `SubstitutionRequestRead[]`, newest arrangement first |
| `GET /{request_id}` | None | 200 `SubstitutionRequestRead` |
| `POST /{request_id}/cancel` | `client_request_id`, `expected_version`, `reason` | 200 cancelled `SubstitutionRequestRead` |
| `POST /{request_id}/replace` | `client_request_id`, `expected_version`, `replacement_reason`, plus the complete new arrangement fields including its own `reason` | 200 cancelled old request with `replacement_request_id`; fetch the new request by ID |
| `POST /{request_id}/complete` | `client_request_id`, `expected_version`, `missing_confirmation_reason: string or null`, `identity_unavailable_reason: string or null`, `declared_exchange_at: datetime or null` | 200 completed `SubstitutionRequestRead` |
| `POST /completed/{substitution_id}/corrections` | `client_request_id`, `reason`, `correction_note` (1–1000 chars each) | 201 `SubstitutionCorrectionRead`; immutable, separately anchored clarification |

One pending arrangement per trip. A replacement cancels the old request and creates a fresh request atomically, with no inherited confirmations. Changing the driver, point or expected time uses replacement; there is no silent PATCH of confirmed facts. Replays of replacement resolve to the same new ID.

Normal completion occurs automatically on the last valid driver confirmation. The dispatcher `/complete` action completes with explicit attestations where needed, or rechecks already saved confirmations after an eligibility blocker is resolved. It does not create or edit driver captures. It needs a missing-confirmation reason if either capture is absent. It needs admin authority and an identity-unavailable reason if the fleet verification status is PENDING, even when that dispatcher may otherwise attest missing confirmation. FAILED identity, inactive accounts, null/expired licences, another organisation and conflicting availability remain refusals. At completion use the actual SAST date, even if the planned date passed the initial check. Licence checks are specific to substitution; baseline activation policy is unchanged.

Accept and retain valid driver captures even if identity or availability prevents immediate transfer: return a pending request with `completion_blocked_by`, not a fabricated completed state. Invalid capture content still fails validation. For multiple eligibility failures return the first in this fixed order: `incoming_driver_inactive`, `licence_invalid`, `driver_unavailable`, `identity_not_verified`. A blocked driver-confirmation response is HTTP 200 because the capture was saved; it is not a failed dispatcher completion. A new `/complete` action with a fresh intentional client key rechecks eligibility; an exact replay of an earlier saved/pending result returns that original result. `completion_mode` is `normal` when both driver captures and VERIFIED identity suffice, even if a dispatcher triggers the recheck; it is `dispatcher_attested` only when missing confirmation or unavailable identity was actually attested. `completion.trigger` records who caused completion independently of that mode. Retrying final completion as a new intentional action rechecks eligibility; it must not erase previously accepted captures. Correction notes annotate the completed record and are included in the timeline and audit; they never rewrite its drivers or effective time. A later actual custody change requires another handover.

## Driver endpoints

New `driver_router` in the same module, prefix `/trips/me`. Register it before the existing `/trips` router so literal routes cannot be consumed as `{trip_id}`.

| Method and suffix | Request | Response |
|---|---|---|
| `GET /driver-substitutions` | None | Pending `SubstitutionRequestRead[]` for this driver as incoming or outgoing; does not replace `/trips/me/active` |
| `GET /{trip_id}/driver-substitutions/{request_id}` | None | Driver-safe `DriverSubstitutionContextRead` |
| `POST /{trip_id}/driver-substitutions/{request_id}/artifacts` | Existing artifact multipart fields plus `client_request_id` and `role`; no `phase_event_id` | 201 existing `EvidenceArtifactRead` |
| `POST /{trip_id}/driver-substitutions/{request_id}/confirmations` | `client_request_id`, `expected_version`, `captured_at`, `latitude`, `longitude`, `accuracy_metres`, `confirmed_vehicle_ids`, `seal_checks`, `discrepancy_note: string or null` | 200 updated `SubstitutionRequestRead`; may now be completed |
| `GET /substitution-notices?unread_only=true` | Optional flag, defaults true; bounded newest-first list | 200 `SubstitutionNoticeRead[]` |
| `POST /substitution-notices/{notice_id}/read` | None | 200 notice; repeated reads preserve the first `read_at` |
| `GET /{trip_id}/participation` | None | `DriverParticipationHistoryRead` described below |
| `POST /{trip_id}/late-evidence/artifacts` | Existing artifact multipart fields plus `client_request_id` and `custody_sequence` | 201 `EvidenceArtifactRead`, retained for review |
| `POST /{trip_id}/late-evidence` | `client_request_id`, `custody_sequence`, `captured_at`, `original_idempotency_key: string or null`, `evidence: LateEvidencePayload`, `artifact_ids` | 201 `LateEvidenceRead`; same evidence receipt on replay |

The driver role on confirmation is determined by the authenticated account. The artifact role is only a claimed purpose: validate it against the account and request. A pending incoming driver can upload takeover evidence, but cannot use normal phase, checkpoint, location or receiver-handover write routes.

`latitude`, `longitude` and `accuracy_metres` are nullable together where capture is unavailable. Preserve that absence explicitly; do not invent a position or verification. Store capture time and server receipt time separately. Capture timestamps never grant authorisation.

`DriverParticipationHistoryRead` contains `trip_id`, `trip_reference`, `trip_status`, this driver's custody periods (`custody_sequence`, start, end, completion mode), their own immutable action references, their own artifact references and authorised signed URLs, and their own handover declarations. It contains no subsequent live tracker trail, other drivers' identity details, full cargo manifest or later unrestricted exception stream. A driver with no participation gets 404.

`LateEvidencePayload` is a discriminated Pydantic/TypeScript union for `phase`, `checkpoint`, `location`, or `exception`: embed the corresponding existing request schema as `payload`, plus a stable `kind`. Never store or replay an arbitrary URL or executable operation. `LateEvidenceRead` contains `id`, `trip_id`, `driver_id`, `custody_sequence`, `captured_at`, `received_at`, `status` (`awaiting_review`, `acknowledged`), `artifact_ids`, `reviewed_by_user_id: UUID or null`, `reviewed_at: datetime or null`, `review_note: string or null`. `LateEvidenceDetailRead` extends this receipt for dispatchers with retained typed `evidence`, `payload_sha256` and scoped artifact URLs so acknowledgement follows an actual review. Late evidence has a durable local commitment and is included in subsequent audit-pack sealing; do not label it independently Hedera-anchored unless a receipt exists.

Dispatcher late-evidence review uses `GET /trips/{trip_id}/late-evidence` and `POST /trips/{trip_id}/late-evidence/{evidence_id}/acknowledge` with `client_request_id` and `note`. Acknowledgement records review; it does not complete a phase, change custody, or insert the report into an earlier place in the ledger.

## Existing reads and writes

- `TripDetailResponse.driver` and dispatcher list `driver` become the derived current driver. Add `original_driver`, ordered `driver_substitutions`, `pending_driver_substitution`, and `custody_sequence`. Keep creation and verification based on the original driver. Dispatcher detail also includes `custody_integrity` with `status`, `amendment_count`, `pending_anchor_count`, and `findings` from the full verification path.
- Dispatcher trip detail exposes `driver_substitutions_enabled: bool`. Server setting `DRIVER_SUBSTITUTIONS_ENABLED`, default false, gates only new arrangement/replacement requests. Disabling it preserves current-driver derivation, pending confirmations/completion/cancellation, history, corrections, late evidence and recovery. Replaying an already accepted arrangement still returns its original result. New requests while disabled return 503 `SUBSTITUTIONS_DISABLED`; do not erase the draft.
- Add `driver_access: DriverAccess or null` to trip detail: populated on current-driver reads, null on dispatcher reads. Driver-safe list rows add `participation: current or former`, `last_participation_ended_at: datetime or null`, and `custody_sequence`; preserve real trip status.
- `/trips/me/active` and `/trips/me/{trip_id}` remain current-assignment reads. A known former participant gets a coded `TRIP_HANDED_OVER` response from detail and uses `/participation`. An unrelated account gets 404. Driver lists retain former participation as history, even while the trip remains active.
- Normal live writes require the current driver. A former driver's new live write returns `TRIP_HANDED_OVER`; the client preserves it for the late-evidence route. Unrelated access is not disclosed.
- New phase, checkpoint, location, exception, artifact and receiver-handover initiation writes carry `custody_sequence` captured with the evidence. Sequence 0 is the original driver period; completed transfers increment it. Missing sequence remains compatible only for trips without substitutions. After a transfer, missing or stale sequence is a retained context conflict, including A→B→A when A is current again. Late evidence may target the caller's own prior sequence even when they are also current in a later sequence.
- Exact replay of an old accepted phase/checkpoint/exception must be bound to its original actor and idempotency key. A former driver can receive a coded `EVIDENCE_ALREADY_RECORDED` acknowledgement with an opaque evidence reference, without receiving current trip detail. The client may clear only that proven duplicate. Legacy trips without substitutions keep their existing replay semantics.
- Receiver one-time links and guard zero-login access retain their existing rules. A former driver cannot issue a new receiver link. Existing links remain bound to their original phase and expiry; substitution cannot retarget them or relabel accepted receiver evidence. Test consent racing handover without creating guard or receiver accounts.

## Stable errors

Use FastAPI's `detail` object for domain conflicts: `{code, message, request_id?, current_version?, evidence_id?}`. Existing clients must parse both legacy string details and this object. Use the endpoint matrix below for status codes; use existing authentication status codes, 403 for an authenticated dispatcher lacking admin-only identity authority, 404 for unrelated resources, and 422 for malformed fields. Do not change global authentication semantics just for this feature.

| Code | Client response |
|---|---|
| `TRIP_HANDED_OVER` | Stop live actions, refresh current assignment, retain draft/queue, offer history or late submission |
| `CUSTODY_CONTEXT_CHANGED` | Retain capture under its original sequence; refetch and offer the late-evidence route |
| `CUSTODY_CONTEXT_REQUIRED` | Do not guess the capture period; retain for explicit review and refresh current assignment |
| `SUBSTITUTION_VERSION_CHANGED` | Refetch the arrangement; keep local capture until the driver decides what to do |
| `SUBSTITUTION_NOT_PENDING` | Refetch; retain unsent evidence and explain cancellation or prior completion |
| `DRIVER_UNAVAILABLE` | Dispatcher selects another driver or changes the pending arrangement |
| `INCOMING_DRIVER_INACTIVE` | Keep saved captures and select an eligible driver through replacement; no takeover |
| `LICENCE_INVALID` | Explain missing/expired expiry and retain saved captures; correcting a fleet record does not itself complete custody |
| `IDENTITY_ATTESTATION_FORBIDDEN` (403) | Dispatcher needs an authorised admin; no identity exception or transfer is recorded |
| `IDENTITY_NOT_VERIFIED` | Show the truthful status; ordinary driver confirmation does not grant ownership |
| `IDEMPOTENCY_KEY_REUSED` | Preserve the draft and require a new intentional action; never silently regenerate during a retry |
| `EVIDENCE_ALREADY_RECORDED` | Clear only the matching actor-bound queued item named by the server |
| `SUBSTITUTIONS_DISABLED` (503) | Keep the form/draft and explain that new arrangements are temporarily unavailable; existing handovers still function |

### Endpoint/status/code matrix

Authentication uses existing 401/403 rules; unrelated/cross-organisation resources are 404 and malformed bodies are 422 throughout. An authorised non-admin supplying a non-null `identity_unavailable_reason` receives 403 `IDENTITY_ATTESTATION_FORBIDDEN`; never silently ignore the supplied reason. Blank/oversized supplied reasons and a missing required `missing_confirmation_reason` are 422. A null identity reason on a PENDING driver means no identity attestation was requested, so completion returns 409 `IDENTITY_NOT_VERIFIED`; an admin can make a new intentional action with a reason. A supplied admin identity reason on VERIFIED is 422 as inapplicable; FAILED always refuses completion. Check these rules after authentication/tenant scoping and exact accepted replay, before creating any completion.

| Endpoint/action | Outcome | HTTP and code/body |
|---|---|---|
| Arrange or replace | New arrangements disabled | 503 `SUBSTITUTIONS_DISABLED`; no state change |
| Arrange or replace | Incoming account inactive, licence missing/expired, reservation conflict | 409 `INCOMING_DRIVER_INACTIVE`, `LICENCE_INVALID`, or `DRIVER_UNAVAILABLE`; no new arrangement/replacement |
| Arrange or replace | Identity PENDING/FAILED | Arrangement may be saved with truthful identity; it grants no custody. FAILED cannot later complete; PENDING needs the admin exception |
| Driver confirmation | Capture saved, all completion checks satisfied and both confirmations present | 200 completed request |
| Driver confirmation | Capture saved, one confirmation absent or eligibility blocks completion | 200 pending request; `missing_confirmations` and nullable `completion_blocked_by` explain why; never return an unsaved-capture error for this outcome |
| Dispatcher complete | All eligibility checks pass and required captures or explicit attestations exist | 200 completed request; mode and trigger follow the rules above |
| Dispatcher complete | FAILED identity or PENDING identity without valid admin attestation | 409 `IDENTITY_NOT_VERIFIED`, except an explicit non-admin attestation attempt is the 403 above; no transfer |
| Dispatcher complete | Incoming inactive, licence invalid or reservation conflict | 409 matching eligibility code; prior captures remain saved |
| Confirm/cancel/replace/complete | Request version changed or no longer pending | 409 `SUBSTITUTION_VERSION_CHANGED` or `SUBSTITUTION_NOT_PENDING`; exact accepted replay returns its original success first |
| Any idempotent mutation | Same actor/action/key with changed body | 409 `IDEMPOTENCY_KEY_REUSED` |
| Existing live trip write | Former actor, stale sequence or required sequence missing | 409 `TRIP_HANDED_OVER`, `CUSTODY_CONTEXT_CHANGED`, or `CUSTODY_CONTEXT_REQUIRED`; retain local evidence |
| Existing live trip write | Proven actor-bound exact accepted replay after transfer | 409 `EVIDENCE_ALREADY_RECORDED` with opaque evidence reference; clear only that matching queued action |
| Arrange / artifact / late evidence / correction | Exact accepted replay | Original success status and safe result; no second side effect. Existing ordinary live-write replay rules remain unchanged on trips without substitutions |

`IDENTITY_ATTESTATION_FORBIDDEN` is a dispatcher permission error, not a driver-completion blocker. A driver never sends an admin identity reason. General eligibility failure precedence follows the fixed order above; the non-admin attestation permission check remains an explicit 403. No endpoint returns a generic 409 to signal a successful new driver confirmation.

Do not treat every 409 as a duplicate. Network errors, 429s and server failures retain local work under the existing retry policy. A new unrecognised conflict is needs-attention, never evidence deletion.

## Legacy local evidence boundary

Older local queue entries lack an authenticated account identifier, not just a custody sequence. Tim must quarantine entries whose original actor cannot be established from trustworthy stored metadata; a trip's current owner or the currently signed-in user is not proof of who captured them. Preserve bytes and request metadata locally, block automatic upload, and offer explicit review/export or deliberate discard. Do not present them as that user's capture or submit them through late evidence under a guessed actor. Where actor is trustworthy but sequence is absent, existing no-substitution compatibility may apply; after a substitution, retain for explicit context review rather than relabelling it.

## Tim's fixture pack and contract gate

Ciaran publishes `frontend/shared/lib/mocks/driver-substitutions.ts` with typed fixtures for: no substitution, outgoing pending, incoming pending with no current trip, one confirmation, normal completed, dispatcher-attested completed, identity unavailable, cancelled/replaced, former history, late evidence, and every coded conflict above. Also include not-applicable seal reason, FAILED identity, missing/expired licence, saved-but-blocked confirmation, context with relevant findings, clarification, custody integrity pending/failed, and flag-off detail. Keep success-body `completion_blocked_by` fixtures separate from error-response fixtures. Publish all request types plus `SubstitutionSealCondition`, `SubstitutionAction`, `DriverSubstitutionContextRead`, `SubstitutionCompletionRead`, `SubstitutionCorrectionRead`, `DriverParticipationHistoryRead`, `CustodyIntegrityRead`, `LateEvidencePayload` and `LateEvidenceDetailRead`; no consumer invents an unshared DTO. Use fictional identities and generated local test IDs.

Before Tim connects real endpoints, both owners check: exact field names and nullability; role-filtered responses; authentication; artifact multipart shape; idempotent retries; final confirmation returning a completed state; former-driver conflicts; and registration order. Generate OpenAPI from the app and compare its schema with these fixtures. Any intentional change is recorded here before either client diverges.
